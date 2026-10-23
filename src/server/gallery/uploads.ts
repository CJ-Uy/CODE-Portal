import { z } from "zod";
import type { GalleryRepository } from "@/db/repositories/gallery";
import type { GalleryItemKind } from "@/db/schema";
import { createId } from "@/lib/ids";
import type { Actor } from "@/server/auth/permissions";
import { imageMagic, type Magic } from "@/server/uploads";
import type { StorageAdapter } from "@/storage/types";

const MB = 1024 * 1024;
/**
 * Every part but the last is exactly this size (R2 requires equal parts of at least 5 MiB). Small enough that
 * one part fits comfortably in a Worker request and in memory; 10,000 parts allows files up to about 100 GB.
 */
export const GALLERY_PART_BYTES = 10 * MB;
const MAX_POSTER_BYTES = 2 * MB;

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
// HEIC and both video containers are ISO media files: "ftyp" at byte 4.
const isoMedia: Magic = [{ at: 4, bytes: ascii("ftyp") }];

type GalleryType = { contentType: string; kind: GalleryItemKind; magic: Magic };
const byExtension = new Map<string, GalleryType>([
	["jpg", { contentType: "image/jpeg", kind: "photo", magic: imageMagic.get("jpg")! }],
	["png", { contentType: "image/png", kind: "photo", magic: imageMagic.get("png")! }],
	["webp", { contentType: "image/webp", kind: "photo", magic: imageMagic.get("webp")! }],
	["gif", { contentType: "image/gif", kind: "photo", magic: imageMagic.get("gif")! }],
	["heic", { contentType: "image/heic", kind: "photo", magic: isoMedia }],
	["heif", { contentType: "image/heif", kind: "photo", magic: isoMedia }],
	["mp4", { contentType: "video/mp4", kind: "video", magic: isoMedia }],
	["mov", { contentType: "video/quicktime", kind: "video", magic: isoMedia }],
	["webm", { contentType: "video/webm", kind: "video", magic: [{ at: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }] }],
]);
const aliases = new Map([["jpeg", "jpg"], ["m4v", "mp4"], ["qt", "mov"]]);

/**
 * The stored extension for an upload, from its declared type, falling back to its file name: Windows reports
 * HEIC and some phone videos with an empty type. Null when the gallery does not take it.
 */
export function galleryExtension(name: string, type: string): string | null {
	for (const [extension, info] of byExtension) if (info.contentType === type) return extension;
	if (type && type !== "application/octet-stream") return null;
	const fromName = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
	const extension = aliases.get(fromName) ?? fromName;
	return byExtension.has(extension) ? extension : null;
}

/** `gallery/<itemId>/<memberId>/original.<ext>`, the only shape this handler issues. */
function parseOriginalKey(key: string): { itemId: string; memberId: string; type: GalleryType } | null {
	const match = key.match(/^gallery\/(gal_[a-z0-9]+)\/([A-Za-z0-9._-]+)\/original\.([a-z0-9]+)$/);
	const type = match && byExtension.get(match[3]);
	return match && type ? { itemId: match[1], memberId: match[2], type } : null;
}

const createSchema = z.object({ name: z.string().min(1).max(255), type: z.string().max(100), size: z.number().int().positive() });
const abortSchema = z.object({ key: z.string(), uploadId: z.string().min(1) });
const partsSchema = z.array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1) })).min(1).max(10_000);
const optionalText = (value: FormDataEntryValue | null) => (typeof value === "string" && value.trim() ? value.trim() : null);

type Dependencies = {
	getActor(request: Request): Promise<Actor | null>;
	storage: StorageAdapter;
	gallery: Pick<GalleryRepository, "createItem">;
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Gallery uploads go straight to R2 in parts: `create` reserves a key, each `PUT` carries one part, `complete`
 * assembles the file, checks its first bytes, stores the browser's video poster and records the item. Keys are
 * always assigned here and tied to the uploader, so nobody can write into someone else's upload.
 */
export function createGalleryUploadHandlers(dependencies: Dependencies) {
	const { storage } = dependencies;

	async function owned(request: Request, key: string) {
		const actor = await dependencies.getActor(request);
		if (!actor) return { error: json({ error: "Authentication required." }, 401) } as const;
		const parsed = parseOriginalKey(key);
		if (!parsed || parsed.memberId !== actor.memberId) return { error: json({ error: "That upload is not yours." }, 403) } as const;
		return { actor, parsed } as const;
	}

	function multipart() {
		const { createMultipartUpload, uploadPart, completeMultipartUpload, abortMultipartUpload } = storage;
		if (!createMultipartUpload || !uploadPart || !completeMultipartUpload || !abortMultipartUpload) return null;
		return {
			create: createMultipartUpload.bind(storage),
			part: uploadPart.bind(storage),
			complete: completeMultipartUpload.bind(storage),
			abort: abortMultipartUpload.bind(storage),
		};
	}

	return {
		async create(request: Request): Promise<Response> {
			const actor = await dependencies.getActor(request);
			if (!actor) return json({ error: "Authentication required." }, 401);
			const mp = multipart();
			if (!mp) return json({ error: "Gallery uploads need R2 or local file storage." }, 501);
			const input = createSchema.safeParse(await request.json().catch(() => null));
			if (!input.success) return json({ error: "Describe the file to upload." }, 400);
			const extension = galleryExtension(input.data.name, input.data.type);
			if (!extension) return json({ error: "The gallery takes photos (JPEG, PNG, WebP, GIF, HEIC) and videos (MP4, MOV, WebM)." }, 415);
			const itemId = createId("gal");
			const key = `gallery/${itemId}/${actor.memberId}/original.${extension}`;
			const { uploadId } = await mp.create(key, byExtension.get(extension)!.contentType);
			return json({ itemId, key, uploadId, partBytes: GALLERY_PART_BYTES }, 201);
		},

		async part(request: Request): Promise<Response> {
			const params = new URL(request.url).searchParams;
			const check = await owned(request, params.get("key") ?? "");
			if (check.error) return check.error;
			const mp = multipart();
			if (!mp) return json({ error: "Gallery uploads need R2 or local file storage." }, 501);
			const partNumber = Number(params.get("part"));
			const uploadId = params.get("uploadId");
			if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000 || !uploadId) return json({ error: "Bad part." }, 400);
			if (Number(request.headers.get("content-length")) > GALLERY_PART_BYTES) return json({ error: "Part is too large." }, 413);
			// A buffer, not the stream: R2 needs a known length, which a request stream does not always carry.
			const body = await request.arrayBuffer();
			if (body.byteLength === 0 || body.byteLength > GALLERY_PART_BYTES) return json({ error: "Part is empty or too large." }, 413);
			try {
				return json(await mp.part(params.get("key")!, uploadId, partNumber, body));
			} catch {
				return json({ error: "That upload expired or was cancelled. Try again." }, 410);
			}
		},

		async complete(request: Request): Promise<Response> {
			const form = await request.formData().catch(() => null);
			if (!form) return json({ error: "Expected a form." }, 400);
			const key = String(form.get("key") ?? "");
			const check = await owned(request, key);
			if (check.error) return check.error;
			const mp = multipart();
			if (!mp) return json({ error: "Gallery uploads need R2 or local file storage." }, 501);
			const { actor, parsed } = check;
			const parts = partsSchema.safeParse(JSON.parse(String(form.get("parts") ?? "null")));
			const uploadId = String(form.get("uploadId") ?? "");
			if (!parts.success || !uploadId) return json({ error: "Bad parts." }, 400);

			let size: number;
			try {
				({ size } = await mp.complete(key, uploadId, parts.data));
			} catch {
				return json({ error: "The upload could not be assembled. Try again." }, 400);
			}
			const posterKey = `gallery/${parsed.itemId}/${actor.memberId}/poster.jpg`;
			const cleanup = () => Promise.all([storage.deleteObject(key), storage.deleteObject(posterKey)]).catch(() => undefined);

			// The declared type is only a claim; the assembled file must start like its format.
			const head = await storage.getObject(key, { range: { offset: 0, length: 16 } });
			const bytes = head.body ? new Uint8Array(await new Response(head.body).arrayBuffer()) : new Uint8Array();
			if (!startsLike(bytes, parsed.type.magic)) {
				await cleanup();
				return json({ error: "The file content does not match its type." }, 415);
			}

			const poster = form.get("poster");
			let storedPoster: string | null = null;
			if (parsed.type.kind === "video" && poster instanceof File && poster.type === "image/jpeg" && poster.size <= MAX_POSTER_BYTES) {
				const posterBytes = new Uint8Array(await poster.arrayBuffer());
				if (startsLike(posterBytes, imageMagic.get("jpg")!)) {
					await storage.putObject({ key: posterKey, body: posterBytes.buffer as ArrayBuffer, contentType: "image/jpeg" });
					storedPoster = posterKey;
				}
			}

			const takenAt = Number(form.get("takenAt"));
			const duration = Number(form.get("durationSeconds"));
			try {
				const item = await dependencies.gallery.createItem(actor, {
					id: parsed.itemId,
					folderId: optionalText(form.get("folderId")),
					kind: parsed.type.kind,
					fileKey: key,
					posterKey: storedPoster,
					contentType: parsed.type.contentType,
					sizeBytes: size,
					durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
					originalName: String(form.get("name") ?? "") || key.slice(key.lastIndexOf("/") + 1),
					caption: optionalText(form.get("caption")),
					takenAt: Number.isFinite(takenAt) && takenAt > 0 ? new Date(takenAt) : null,
					eventId: optionalText(form.get("eventId")),
				});
				return json({ item }, 201);
			} catch (error) {
				// Without its row, nothing could ever find or purge the file, so it goes now.
				await cleanup();
				return json({ error: error instanceof Error ? error.message : "The upload could not be saved." }, 400);
			}
		},

		async abort(request: Request): Promise<Response> {
			const input = abortSchema.safeParse(await request.json().catch(() => null));
			if (!input.success) return json({ error: "Bad request." }, 400);
			const check = await owned(request, input.data.key);
			if (check.error) return check.error;
			await multipart()?.abort(input.data.key, input.data.uploadId).catch(() => undefined);
			return new Response(null, { status: 204 });
		},
	};
}

function startsLike(head: Uint8Array, magic: Magic): boolean {
	return magic.every(({ at, bytes }) => bytes.every((byte, index) => head[at + index] === byte));
}
