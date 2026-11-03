import { createId } from "@/lib/ids";
import { can, type Actor } from "@/server/auth/permissions";
import type { StorageAdapter, StorageRange } from "@/storage/types";

const MB = 1024 * 1024;
export const MAX_UPLOAD_BYTES = 5 * MB;
// The purpose travels in the multipart body, so the pre-parse size gate can only use the largest limit.
// The slack covers multipart boundaries and the small text fields around the file.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const imageTypes = new Map([
	["image/gif", "gif"],
	["image/jpeg", "jpg"],
	["image/png", "png"],
	["image/webp", "webp"],
]);

const libraryFileTypes = new Map([
	["application/pdf", "pdf"],
	["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
	["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
	["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
]);

// A declared type is only a claim. Library uploads must also start with the bytes of their format.
// The other image purposes are served with their stored type and are not sniffed.
export type Magic = { at: number; bytes: number[] }[];
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const ZIP_MAGIC: Magic = [{ at: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }];

const documentMagic = new Map<string, Magic>([
	["pdf", [{ at: 0, bytes: ascii("%PDF-") }]],
	["docx", ZIP_MAGIC],
	["pptx", ZIP_MAGIC],
	["xlsx", ZIP_MAGIC],
]);

export const imageMagic = new Map<string, Magic>([
	["gif", [{ at: 0, bytes: ascii("GIF8") }]],
	["jpg", [{ at: 0, bytes: [0xff, 0xd8, 0xff] }]],
	["png", [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }]],
	["webp", [{ at: 0, bytes: ascii("RIFF") }, { at: 8, bytes: ascii("WEBP") }]],
]);

type UploadRule = { label: "Image" | "File"; types: Map<string, string>; maxBytes: number; magic?: Map<string, Magic> };
const imageRule = (maxBytes: number, magic?: Map<string, Magic>): UploadRule => ({ label: "Image", types: imageTypes, maxBytes, magic });

const uploadRules = new Map<string, UploadRule>([
	["avatar", imageRule(MAX_UPLOAD_BYTES)],
	["event_media", imageRule(MAX_UPLOAD_BYTES)],
	["link_preview", imageRule(MAX_UPLOAD_BYTES)],
	["email_image", imageRule(MAX_UPLOAD_BYTES)],
	["library_image", imageRule(10 * MB, imageMagic)],
	["library_file", { label: "File", types: libraryFileTypes, maxBytes: 50 * MB, magic: documentMagic }],
]);

const MAX_MULTIPART_BYTES = Math.max(...[...uploadRules.values()].map((rule) => rule.maxBytes)) + MULTIPART_OVERHEAD_BYTES;

// PDFs and images open in the browser; everything else downloads.
const inlineExtensions = new Set([...imageTypes.values(), "pdf"]);

type UploadHandlerDependencies = {
	getActor(request: Request): Promise<Actor | null>;
	storage: StorageAdapter;
	canPostEvent(actor: Actor, eventId: string): Promise<boolean>;
	canEditLink(actor: Actor, linkId: string): Promise<boolean>;
	canEditLibraryItem(actor: Actor, itemId: string): Promise<boolean>;
	canReadLibraryObject(actor: Actor, itemId: string): Promise<boolean>;
	/** Gallery files: a null actor is a signed-out visitor, who may only read items in public folders. */
	canReadGalleryObject(actor: Actor | null, itemId: string): Promise<boolean>;
	/** A webp `width` pixels wide, or null when the Images binding is missing or cannot read the file. */
	transformImage?(body: ReadableStream, width: number): Promise<ArrayBuffer | null>;
};

// Grid tiles and the lightbox. Each width of each photo is transformed once, then kept beside the original.
export const GALLERY_PREVIEW_WIDTHS = new Set([480, 1600]);
// The Images binding reads at most 20 MB; anything larger is served as the original.
const MAX_TRANSFORM_BYTES = 20 * MB;
const galleryPhotoExtensions = new Set(["jpg", "png", "webp", "gif", "heic", "heif"]);

export function createUploadHandlers(dependencies: UploadHandlerDependencies) {
	return {
		async collection(request: Request): Promise<Response> {
			const actor = await dependencies.getActor(request);
			if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
			if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
			if (request.headers.has("x-object-key")) {
				return Response.json({ error: "Upload keys are assigned by the server." }, { status: 400 });
			}
			const contentLength = Number(request.headers.get("content-length"));
			if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
				return Response.json({ error: "Upload exceeds the size limit." }, { status: 413 });
			}

			const contentType = request.headers.get("content-type") ?? "";
			if (!contentType.includes("multipart/form-data")) {
				return Response.json({ error: "Expected a multipart upload." }, { status: 400 });
			}

			// ponytail: formData() buffers the whole body (50 MB library files; the isolate limit is about 128 MB).
			// Past that, switch to presigned direct-to-R2 uploads.
			const form = await request.formData();
			if (form.has("key")) {
				return Response.json({ error: "Upload keys are assigned by the server." }, { status: 400 });
			}
			const file = form.get("file");
			if (!(file instanceof File)) {
				return Response.json({ error: "Expected multipart field named file." }, { status: 400 });
			}

			const purpose = form.get("purpose");
			const rule = typeof purpose === "string" ? uploadRules.get(purpose) : undefined;
			if (!rule) {
				return Response.json({ error: "Unknown upload purpose." }, { status: 400 });
			}
			const extension = rule.types.get(file.type);
			if (!extension) {
				return Response.json({ error: `Unsupported ${rule.label.toLowerCase()} type.` }, { status: 415 });
			}
			if (file.size > rule.maxBytes) {
				return Response.json({ error: `${rule.label} exceeds the ${rule.maxBytes / MB} MB limit.` }, { status: 413 });
			}
			if (!(await matchesMagic(file, rule.magic?.get(extension)))) {
				return Response.json({ error: "The file content does not match its type." }, { status: 415 });
			}

			let key: string;
			if (purpose === "avatar") {
				key = `avatars/${actor.memberId}/${createId("avatar")}.${extension}`;
			} else if (purpose === "event_media") {
				const eventId = form.get("eventId");
				if (typeof eventId !== "string" || !isSafeSegment(eventId)) {
					return Response.json({ error: "A valid event is required." }, { status: 400 });
				}
				if (!(await dependencies.canPostEvent(actor, eventId))) {
					return Response.json({ error: "Not authorized to upload media for this event." }, { status: 403 });
				}
				key = `events/${eventId}/${actor.memberId}/${createId("media")}.${extension}`;
			} else if (purpose === "link_preview") {
				const linkId = form.get("linkId");
				if (typeof linkId !== "string" || !isSafeSegment(linkId)) {
					return Response.json({ error: "A valid link is required." }, { status: 400 });
				}
				if (!(await dependencies.canEditLink(actor, linkId))) {
					return Response.json({ error: "Not authorized to upload a preview for this link." }, { status: 403 });
				}
				key = `links/${linkId}/${actor.memberId}/${createId("preview")}.${extension}`;
			} else if (purpose === "email_image") {
				if (!can(actor, "email:send")) {
					return Response.json({ error: "Not authorized to upload email images." }, { status: 403 });
				}
				key = `email-images/${actor.memberId}/${createId("image")}.${extension}`;
			} else if (purpose === "library_file" || purpose === "library_image") {
				// The item's file_key is set by the server from this result, never by the client.
				const itemId = form.get("itemId");
				if (typeof itemId !== "string" || !isSafeSegment(itemId)) {
					return Response.json({ error: "A valid library item is required." }, { status: 400 });
				}
				if (!(await dependencies.canEditLibraryItem(actor, itemId))) {
					return Response.json({ error: "Not authorized to upload to this library item." }, { status: 403 });
				}
				// ponytail: abandoned drafts leave their files in R2; sweep unreferenced `library/` keys with a cleanup job later.
				key = `library/${itemId}/${actor.memberId}/${createId(purpose === "library_file" ? "lfile" : "limg")}.${extension}`;
			} else {
				return Response.json({ error: "Unknown upload purpose." }, { status: 400 });
			}

			const result = await dependencies.storage.putObject({ key, body: file, contentType: file.type });
			return Response.json(result, { status: 201 });
		},

		async object(request: Request, key: string): Promise<Response> {
			const namespace = parseNamespace(key);
			if (!namespace) return Response.json({ error: "Object not found." }, { status: 404 });

			if (request.method === "GET" && namespace.galleryItemId) {
				const actor = await dependencies.getActor(request);
				// 404 for everyone it hides from, signed in or not: a hidden file's existence is not confirmed.
				if (!(await dependencies.canReadGalleryObject(actor, namespace.galleryItemId))) {
					return Response.json({ error: "Object not found." }, { status: 404 });
				}
				return serveGalleryObject(request, key, dependencies);
			}

			if (request.method === "GET") {
				if (!namespace.public) {
					const actor = await dependencies.getActor(request);
					if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
					// 404, not 403: a member who cannot read the item learns nothing about its files.
					if (namespace.libraryItemId && !(await dependencies.canReadLibraryObject(actor, namespace.libraryItemId))) {
						return Response.json({ error: "Object not found." }, { status: 404 });
					}
				}
				const object = await dependencies.storage.getObject(key);
				if (!object.body) return Response.json({ error: "Object not found." }, { status: 404 });
				const headers = new Headers({
					"Content-Type": object.contentType ?? "application/octet-stream",
					"X-Content-Type-Options": "nosniff",
				});
				if (object.contentLength !== undefined) headers.set("Content-Length", String(object.contentLength));
				if (namespace.libraryItemId) {
					headers.set("Content-Disposition", libraryDisposition(new URL(request.url).searchParams, key));
					headers.set("Cache-Control", "private, no-store");
				}
				return new Response(object.body, { headers });
			}

			const actor = await dependencies.getActor(request);
			if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });

			if (request.method === "DELETE") {
				let authorized: boolean;
				if (namespace.galleryItemId) {
					// Gallery files only go through a soft delete and the 30-day purge, never straight out of R2.
					authorized = false;
				} else if (namespace.libraryItemId) {
					authorized = can(actor, "library:manage");
				} else if (namespace.linkId) {
					authorized = can(actor, "link:moderate") || await dependencies.canEditLink(actor, namespace.linkId);
				} else {
					authorized = namespace.ownerMemberId === actor.memberId || can(actor, "member:manage");
				}
				if (!authorized) {
					return Response.json({ error: "Not authorized to delete this object." }, { status: 403 });
				}
				await dependencies.storage.deleteObject(key);
				return new Response(null, { status: 204 });
			}

			return new Response("Method not allowed", { status: 405 });
		},
	};
}

/**
 * A gallery file, already access-checked. `?w=480|1600` on a photo serves a webp preview, made by the Images
 * binding on first request and stored next to the original. Videos honour Range so they can seek and play on iOS.
 * Keys never change content, so the browser may keep what it fetched.
 */
async function serveGalleryObject(request: Request, key: string, dependencies: UploadHandlerDependencies): Promise<Response> {
	const params = new URL(request.url).searchParams;
	const width = Number(params.get("w"));
	const extension = key.slice(key.lastIndexOf(".") + 1);
	const headers = new Headers({ "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400", "Accept-Ranges": "bytes" });

	if (GALLERY_PREVIEW_WIDTHS.has(width) && galleryPhotoExtensions.has(extension)) {
		const previewKey = key.replace(/[^/]+$/, `w${width}.webp`);
		const cached = await dependencies.storage.getObject(previewKey);
		if (cached.body) {
			headers.set("Content-Type", "image/webp");
			return new Response(cached.body, { headers });
		}
		const original = await dependencies.storage.getObject(key);
		if (original.body && dependencies.transformImage && (original.contentLength ?? Infinity) <= MAX_TRANSFORM_BYTES) {
			const preview = await dependencies.transformImage(original.body, width).catch(() => null);
			if (preview) {
				await dependencies.storage.putObject({ key: previewKey, body: preview.slice(0), contentType: "image/webp" });
				headers.set("Content-Type", "image/webp");
				return new Response(preview, { headers });
			}
		} else {
			await original.body?.cancel();
		}
		// No binding (local dev), too large, or a format the binding cannot read: the original still works.
	}

	const range = parseRangeHeader(request.headers.get("range"));
	let object: Awaited<ReturnType<StorageAdapter["getObject"]>>;
	try {
		object = await dependencies.storage.getObject(key, range ? { range } : undefined);
	} catch {
		// R2 and the local adapter both throw for a range past the end of the file.
		return new Response(null, { status: 416 });
	}
	if (!object.body) return Response.json({ error: "Object not found." }, { status: 404 });
	headers.set("Content-Type", object.contentType ?? "application/octet-stream");
	if (object.contentLength !== undefined) headers.set("Content-Length", String(object.contentLength));
	if (params.get("download") === "1") headers.set("Content-Disposition", libraryDisposition(params, key));
	if (object.range) {
		const { offset, length, size } = object.range;
		headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${size}`);
		return new Response(object.body, { status: 206, headers });
	}
	return new Response(object.body, { headers });
}

/** One `bytes=` range from a Range header. Anything else (several ranges, other units, garbage) reads the whole file. */
export function parseRangeHeader(header: string | null): StorageRange | null {
	const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
	if (!match || (!match[1] && !match[2])) return null;
	if (!match[1]) return { suffix: Number(match[2]) };
	const offset = Number(match[1]);
	if (!match[2]) return { offset };
	const end = Number(match[2]);
	return end < offset ? null : { offset, length: end - offset + 1 };
}

async function matchesMagic(file: File, magic: Magic | undefined): Promise<boolean> {
	if (!magic) return true;
	const head = new Uint8Array(await file.slice(0, Math.max(...magic.map(({ at, bytes }) => at + bytes.length))).arrayBuffer());
	return magic.every(({ at, bytes }) => bytes.every((byte, index) => head[at + index] === byte));
}

/**
 * `inline` for PDFs and images, `attachment` for the rest or on `?download=1`.
 * The name is the `name` query value kept to plain ASCII, and it always ends with the key's own extension:
 * a caller cannot pick what a download is called on this origin (`name=Setup.exe` on a `.png` key serves `Setup.png`).
 */
function libraryDisposition(params: URLSearchParams, key: string): string {
	const basename = key.slice(key.lastIndexOf("/") + 1);
	const dot = basename.lastIndexOf(".");
	const extension = dot < 0 ? "" : basename.slice(dot);
	const inline = inlineExtensions.has(extension.slice(1)) && params.get("download") !== "1";
	const stem = (params.get("name") ?? "")
		.replace(/["\\]/g, "")
		.replace(/[^\x20-\x7e]/gu, "_")
		.trim()
		.slice(0, 200)
		.replace(/\.[^.]*$/, "")
		.trim();
	return `${inline ? "inline" : "attachment"}; filename="${stem ? stem + extension : basename}"`;
}

function parseNamespace(
	key: string,
): { ownerMemberId: string; public: boolean; linkId?: string; libraryItemId?: string; galleryItemId?: string } | null {
	if (key.includes("..") || key.startsWith("/")) return null;
	const parts = key.split("/");
	if (parts[0] === "avatars" && parts.length === 3 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[1], public: false };
	}
	if (parts[0] === "events" && parts.length === 4 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[2], public: false };
	}
	if (parts[0] === "links" && parts.length === 4 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[2], public: true, linkId: parts[1] };
	}
	if (parts[0] === "email-images" && parts.length === 3 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[1], public: true };
	}
	if (parts[0] === "library" && parts.length === 4 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[2], public: false, libraryItemId: parts[1] };
	}
	if (parts[0] === "gallery" && parts.length === 4 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[2], public: false, galleryItemId: parts[1] };
	}
	return null;
}

function isSafeSegment(value: string): boolean {
	return /^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}
