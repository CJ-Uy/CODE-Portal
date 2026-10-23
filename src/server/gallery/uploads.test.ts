import { describe, expect, it } from "vitest";
import type { CreateGalleryItemInput } from "@/db/repositories/gallery";
import type { Actor } from "@/server/auth/permissions";
import type { StorageAdapter, StorageBody, StorageRange, StorageUploadedPart } from "@/storage/types";
import { createGalleryUploadHandlers, galleryExtension } from "./uploads";

const ana: Actor = { memberId: "ana", roles: ["member"] };
const ben: Actor = { memberId: "ben", roles: ["member"] };
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4];
const MP4 = [0, 0, 0, 0x18, ...[..."ftypmp42"].map((c) => c.charCodeAt(0))];

/** In-memory storage with multipart, enough to run the real handler end to end. */
class MultipartMemory implements StorageAdapter {
	readonly adapterType = "local-fs" as const;
	objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
	uploads = new Map<string, { key: string; contentType: string; parts: Map<number, Uint8Array> }>();

	async putObject(input: { key: string; body: StorageBody; contentType?: string }) {
		this.objects.set(input.key, { bytes: new Uint8Array(await new Response(input.body as BodyInit).arrayBuffer()), contentType: input.contentType });
		return { key: input.key };
	}
	async getObject(key: string, options?: { range?: StorageRange }) {
		const object = this.objects.get(key);
		if (!object) return { body: null };
		const range = options?.range && "offset" in options.range ? options.range : { offset: 0 };
		const bytes = object.bytes.slice(range.offset, range.length === undefined ? undefined : range.offset + range.length);
		return { body: new Response(bytes).body, contentType: object.contentType, contentLength: bytes.byteLength };
	}
	async deleteObject(key: string) {
		this.objects.delete(key);
	}
	async createMultipartUpload(key: string, contentType: string) {
		const uploadId = `up${this.uploads.size}`;
		this.uploads.set(uploadId, { key, contentType, parts: new Map() });
		return { uploadId };
	}
	async uploadPart(key: string, uploadId: string, partNumber: number, body: ArrayBuffer): Promise<StorageUploadedPart> {
		const upload = this.uploads.get(uploadId);
		if (!upload || upload.key !== key) throw new Error("NoSuchUpload");
		upload.parts.set(partNumber, new Uint8Array(body));
		return { partNumber, etag: `e${partNumber}` };
	}
	async completeMultipartUpload(key: string, uploadId: string, parts: StorageUploadedPart[]) {
		const upload = this.uploads.get(uploadId)!;
		const bytes = parts.flatMap((part) => [...upload.parts.get(part.partNumber)!]);
		this.objects.set(key, { bytes: new Uint8Array(bytes), contentType: upload.contentType });
		this.uploads.delete(uploadId);
		return { size: bytes.length };
	}
	async abortMultipartUpload(_key: string, uploadId: string) {
		this.uploads.delete(uploadId);
	}
}

function setup(actor: Actor | null, createItem?: (actor: Actor, input: CreateGalleryItemInput) => Promise<never>) {
	const storage = new MultipartMemory();
	const created: CreateGalleryItemInput[] = [];
	const handlers = createGalleryUploadHandlers({
		getActor: async () => actor,
		storage,
		gallery: { createItem: createItem ?? (async (_actor, input) => (created.push(input), input as never)) },
	});
	return { storage, created, handlers };
}

const post = (body: unknown) => new Request("https://example.com/api/gallery/uploads", { method: "POST", body: JSON.stringify(body) });

async function uploadThrough(handlers: ReturnType<typeof setup>["handlers"], name: string, type: string, bytes: number[], extra: Record<string, string | Blob> = {}) {
	const created = await handlers.create(post({ name, type, size: bytes.length }));
	const { key, uploadId } = (await created.json()) as { key: string; uploadId: string };
	const part = await handlers.part(new Request(`https://example.com/x?key=${encodeURIComponent(key)}&uploadId=${uploadId}&part=1`, { method: "PUT", body: new Uint8Array(bytes) }));
	const form = new FormData();
	form.set("key", key);
	form.set("uploadId", uploadId);
	form.set("parts", JSON.stringify([await part.json()]));
	form.set("name", name);
	for (const [field, value] of Object.entries(extra)) form.set(field, value);
	return { key, response: await handlers.complete(new Request("https://example.com/x", { method: "POST", body: form })) };
}

describe("gallery uploads", () => {
	it("assigns the key, assembles the parts and records the item with server-checked type and size", async () => {
		const { handlers, created, storage } = setup(ana);
		const { key, response } = await uploadThrough(handlers, "beach.jpg", "image/jpeg", JPEG, { caption: " sunset ", takenAt: "1700000000000" });
		expect(response.status).toBe(201);
		expect(key).toMatch(/^gallery\/gal_[a-z0-9]+\/ana\/original\.jpg$/);
		expect(created).toEqual([expect.objectContaining({ fileKey: key, kind: "photo", contentType: "image/jpeg", sizeBytes: JPEG.length, caption: "sunset", takenAt: new Date(1_700_000_000_000) })]);
		expect(storage.objects.has(key)).toBe(true);
	});

	it("keeps another member from writing parts into or completing someone else's upload", async () => {
		const owner = setup(ana);
		const created = await owner.handlers.create(post({ name: "a.jpg", type: "image/jpeg", size: 8 }));
		const { key, uploadId } = (await created.json()) as { key: string; uploadId: string };
		const intruder = createGalleryUploadHandlers({ getActor: async () => ben, storage: owner.storage, gallery: { createItem: async () => ({}) as never } });
		const part = await intruder.part(new Request(`https://example.com/x?key=${encodeURIComponent(key)}&uploadId=${uploadId}&part=1`, { method: "PUT", body: new Uint8Array(JPEG) }));
		expect(part.status).toBe(403);
	});

	it("deletes the file when its bytes do not match the declared type", async () => {
		const { handlers, created, storage } = setup(ana);
		const { key, response } = await uploadThrough(handlers, "fake.jpg", "image/jpeg", [1, 2, 3, 4, 5, 6, 7, 8]);
		expect(response.status).toBe(415);
		expect(storage.objects.has(key)).toBe(false);
		expect(created).toEqual([]);
	});

	it("stores a browser-made poster for a video and reads HEIC or MOV by file name when the type is blank", async () => {
		const { handlers, created } = setup(ana);
		const poster = new File([new Uint8Array(JPEG)], "poster.jpg", { type: "image/jpeg" });
		const { response } = await uploadThrough(handlers, "clip.MOV", "", MP4, { poster, durationSeconds: "12.5" });
		expect(response.status).toBe(201);
		expect(created[0]).toMatchObject({ kind: "video", contentType: "video/quicktime", durationSeconds: 12.5 });
		expect(created[0].posterKey).toMatch(/\/poster\.jpg$/);
		expect(galleryExtension("IMG_1.HEIC", "")).toBe("heic");
		expect(galleryExtension("notes.txt", "text/plain")).toBeNull();
		expect(galleryExtension("song.mp3", "")).toBeNull();
	});

	it("removes the file when the item cannot be saved, so nothing is orphaned in R2", async () => {
		const { handlers, storage } = setup(ana, async () => {
			throw new Error("That folder no longer exists.");
		});
		const { key, response } = await uploadThrough(handlers, "a.jpg", "image/jpeg", JPEG);
		expect(response.status).toBe(400);
		expect(((await response.json()) as { error: string }).error).toBe("That folder no longer exists.");
		expect(storage.objects.has(key)).toBe(false);
	});

	it("answers 400, not 500, when the parts list is not JSON", async () => {
		const { handlers } = setup(ana);
		const created = await handlers.create(post({ name: "a.jpg", type: "image/jpeg", size: 8 }));
		const { key, uploadId } = (await created.json()) as { key: string; uploadId: string };
		const form = new FormData();
		form.set("key", key);
		form.set("uploadId", uploadId);
		form.set("parts", "{not json");
		expect((await handlers.complete(new Request("https://example.com/x", { method: "POST", body: form }))).status).toBe(400);
	});

	it("rejects signed-out uploads and types the gallery does not take", async () => {
		expect((await setup(null).handlers.create(post({ name: "a.jpg", type: "image/jpeg", size: 1 }))).status).toBe(401);
		expect((await setup(ana).handlers.create(post({ name: "a.pdf", type: "application/pdf", size: 1 }))).status).toBe(415);
	});
});
