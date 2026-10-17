import { createId } from "@/lib/ids";
import { can, type Actor } from "@/server/auth/permissions";
import type { StorageAdapter } from "@/storage/types";

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

type UploadRule = { label: "Image" | "File"; types: Map<string, string>; maxBytes: number };
const imageRule = (maxBytes: number): UploadRule => ({ label: "Image", types: imageTypes, maxBytes });

const uploadRules = new Map<string, UploadRule>([
	["avatar", imageRule(MAX_UPLOAD_BYTES)],
	["event_media", imageRule(MAX_UPLOAD_BYTES)],
	["link_preview", imageRule(MAX_UPLOAD_BYTES)],
	["email_image", imageRule(MAX_UPLOAD_BYTES)],
	["library_image", imageRule(10 * MB)],
	["library_file", { label: "File", types: libraryFileTypes, maxBytes: 50 * MB }],
]);

const MAX_MULTIPART_BYTES = Math.max(...[...uploadRules.values()].map((rule) => rule.maxBytes)) + MULTIPART_OVERHEAD_BYTES;

// A declared type is only a claim. Library documents must also start with the bytes of their format;
// images are served with their stored type and are not sniffed.
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const fileSignatures = new Map<string, number[]>([
	["pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
	["docx", ZIP_SIGNATURE],
	["pptx", ZIP_SIGNATURE],
	["xlsx", ZIP_SIGNATURE],
]);

// PDFs and images open in the browser; everything else downloads.
const inlineExtensions = new Set([...imageTypes.values(), "pdf"]);

type UploadHandlerDependencies = {
	getActor(request: Request): Promise<Actor | null>;
	storage: StorageAdapter;
	canPostEvent(actor: Actor, eventId: string): Promise<boolean>;
	canEditLink(actor: Actor, linkId: string): Promise<boolean>;
	canEditLibraryItem(actor: Actor, itemId: string): Promise<boolean>;
	canReadLibraryObject(actor: Actor, itemId: string): Promise<boolean>;
};

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
			if (!(await startsWithSignature(file, fileSignatures.get(extension)))) {
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
			} else {
				// library_file or library_image: the item's file_key is set by the server from this result, never by the client.
				const itemId = form.get("itemId");
				if (typeof itemId !== "string" || !isSafeSegment(itemId)) {
					return Response.json({ error: "A valid library item is required." }, { status: 400 });
				}
				if (!(await dependencies.canEditLibraryItem(actor, itemId))) {
					return Response.json({ error: "Not authorized to upload to this library item." }, { status: 403 });
				}
				// ponytail: abandoned drafts leave their files in R2; sweep unreferenced `library/` keys with a cleanup job later.
				key = `library/${itemId}/${actor.memberId}/${createId(purpose === "library_file" ? "lfile" : "limg")}.${extension}`;
			}

			const result = await dependencies.storage.putObject({ key, body: file, contentType: file.type });
			return Response.json(result, { status: 201 });
		},

		async object(request: Request, key: string): Promise<Response> {
			const namespace = parseNamespace(key);
			if (!namespace) return Response.json({ error: "Object not found." }, { status: 404 });

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
				const headers = new Headers({ "Content-Type": object.contentType ?? "application/octet-stream" });
				if (object.contentLength !== undefined) headers.set("Content-Length", String(object.contentLength));
				if (namespace.libraryItemId) {
					headers.set("Content-Disposition", libraryDisposition(new URL(request.url).searchParams, key));
					headers.set("X-Content-Type-Options", "nosniff");
				}
				return new Response(object.body, { headers });
			}

			const actor = await dependencies.getActor(request);
			if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });

			if (request.method === "DELETE") {
				let authorized: boolean;
				if (namespace.libraryItemId) {
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

async function startsWithSignature(file: File, signature: number[] | undefined): Promise<boolean> {
	if (!signature) return true;
	const head = new Uint8Array(await file.slice(0, signature.length).arrayBuffer());
	return signature.every((byte, index) => head[index] === byte);
}

/** `inline` for PDFs and images, `attachment` for the rest or on `?download=1`. The name is the `name` query value, kept to plain ASCII. */
function libraryDisposition(params: URLSearchParams, key: string): string {
	const basename = key.slice(key.lastIndexOf("/") + 1);
	const inline = inlineExtensions.has(basename.slice(basename.lastIndexOf(".") + 1)) && params.get("download") !== "1";
	const name = (params.get("name") ?? "")
		.replace(/["\\]/g, "")
		.replace(/[^\x20-\x7e]/gu, "_")
		.trim()
		.slice(0, 200);
	return `${inline ? "inline" : "attachment"}; filename="${name || basename}"`;
}

function parseNamespace(key: string): { ownerMemberId: string; public: boolean; linkId?: string; libraryItemId?: string } | null {
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
	return null;
}

function isSafeSegment(value: string): boolean {
	return /^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}
