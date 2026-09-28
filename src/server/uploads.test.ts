import { describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import type { StorageAdapter, StorageBody } from "@/storage/types";
import { createUploadHandlers, MAX_UPLOAD_BYTES } from "./uploads";

const memberActor: Actor = { memberId: "mem_upload", roles: ["member"] };

describe("upload handlers", () => {
	it("requires authentication for uploads", async () => {
		const handlers = createHandlers(null);
		const response = await handlers.collection(new Request("https://example.com/api/uploads", { method: "POST" }));
		expect(response.status).toBe(401);
	});

	it.each(["x-object-key", "X-Object-Key"])("rejects a caller-supplied %s", async (header) => {
		const handlers = createHandlers(memberActor);
		const response = await handlers.collection(
			new Request("https://example.com/api/uploads", {
				method: "POST",
				headers: { [header]: "avatars/another-member/forced.png" },
			}),
		);
		expect(response.status).toBe(400);
	});

	it("rejects a multipart key field", async () => {
		const handlers = createHandlers(memberActor);
		const form = imageForm();
		form.set("key", "avatars/another-member/forced.png");
		const response = await handlers.collection(
			new Request("https://example.com/api/uploads", { method: "POST", body: form }),
		);
		expect(response.status).toBe(400);
	});

	it("rejects unsupported content types and oversized images", async () => {
		const handlers = createHandlers(memberActor);
		const textForm = new FormData();
		textForm.set("purpose", "avatar");
		textForm.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
		const textResponse = await handlers.collection(
			new Request("https://example.com/api/uploads", { method: "POST", body: textForm }),
		);

		const largeForm = new FormData();
		largeForm.set("purpose", "avatar");
		largeForm.set("file", new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "large.png", { type: "image/png" }));
		const largeResponse = await handlers.collection(
			new Request("https://example.com/api/uploads", { method: "POST", body: largeForm }),
		);

		expect(textResponse.status).toBe(415);
		expect(largeResponse.status).toBe(413);
	});

	it("assigns an avatar key in the authenticated member namespace", async () => {
		const storage = new MemoryStorage();
		const handlers = createHandlers(memberActor, storage);
		const response = await handlers.collection(
			new Request("https://example.com/api/uploads", { method: "POST", body: imageForm() }),
		);
		const body = await response.json() as { key: string };

		expect(response.status).toBe(201);
		expect(body.key).toMatch(/^avatars\/mem_upload\/[a-z0-9_-]+\.png$/);
		expect(storage.keys()).toEqual([body.key]);
	});

	it("requires authentication for reads and deletes", async () => {
		const handlers = createHandlers(null);
		const getResponse = await handlers.object(
			new Request("https://example.com/api/uploads/key"),
			"avatars/mem_upload/avatar.png",
		);
		const deleteResponse = await handlers.object(
			new Request("https://example.com/api/uploads/key", { method: "DELETE" }),
			"avatars/mem_upload/avatar.png",
		);

		expect(getResponse.status).toBe(401);
		expect(deleteResponse.status).toBe(401);
	});

	it("allows member reads but only owner or admin deletes", async () => {
		const storage = new MemoryStorage();
		await storage.putObject({ key: "avatars/other/avatar.png", body: "image", contentType: "image/png" });
		const handlers = createHandlers(memberActor, storage);

		const getResponse = await handlers.object(
			new Request("https://example.com/api/uploads/key"),
			"avatars/other/avatar.png",
		);
		const deleteResponse = await handlers.object(
			new Request("https://example.com/api/uploads/key", { method: "DELETE" }),
			"avatars/other/avatar.png",
		);

		expect(getResponse.status).toBe(200);
		expect(deleteResponse.status).toBe(403);
	});

	it("assigns a server key for a link preview image the actor may edit", async () => {
		const handlers = createHandlers(memberActor, { canEditLink: async (_actor, id) => id === "lnk_ok" });
		const form = imageForm();
		form.set("purpose", "link_preview");
		form.set("linkId", "lnk_ok");
		const res = await handlers.collection(new Request("https://example.com/api/uploads", { method: "POST", body: form }));
		expect(res.status).toBe(201);
		expect((await res.json() as { key: string }).key).toMatch(/^links\/lnk_ok\/mem_upload\/.+/);
	});

	it("rejects a link preview upload the actor may not edit", async () => {
		const handlers = createHandlers(memberActor, { canEditLink: async () => false });
		const form = imageForm();
		form.set("purpose", "link_preview");
		form.set("linkId", "lnk_no");
		const res = await handlers.collection(new Request("https://example.com/api/uploads", { method: "POST", body: form }));
		expect(res.status).toBe(403);
	});

	it("serves a link preview image without authentication", async () => {
		const storage = new MemoryStorage();
		await storage.putObject({ key: "links/lnk_ok/mem_upload/img.png", body: "image", contentType: "image/png" });
		const handlers = createHandlers(null, storage);
		const res = await handlers.object(
			new Request("https://example.com/api/uploads/links%2Flnk_ok%2Fmem_upload%2Fimg.png", { method: "GET" }),
			"links/lnk_ok/mem_upload/img.png",
		);
		expect(res.status).toBe(200);
	});

	it("uses link edit permission, not uploader identity, for link object deletes", async () => {
		const storage = new MemoryStorage();
		await storage.putObject({ key: "links/lnk_ok/other/img.png", body: "image", contentType: "image/png" });
		await storage.putObject({ key: "links/lnk_no/mem_upload/img.png", body: "image", contentType: "image/png" });
		const handlers = createHandlers(memberActor, { storage, canEditLink: async (_actor, id) => id === "lnk_ok" });

		const moderatorDelete = await handlers.object(
			new Request("https://example.com/api/uploads/key", { method: "DELETE" }),
			"links/lnk_ok/other/img.png",
		);
		const uploaderDelete = await handlers.object(
			new Request("https://example.com/api/uploads/key", { method: "DELETE" }),
			"links/lnk_no/mem_upload/img.png",
		);

		expect(moderatorDelete.status).toBe(204);
		expect(uploaderDelete.status).toBe(403);
	});

	it("allows a link moderator to delete an orphaned link object", async () => {
		const storage = new MemoryStorage();
		const key = "links/lnk_removed/other/img.png";
		await storage.putObject({ key, body: "image", contentType: "image/png" });
		const moderator: Actor = { memberId: "mem_mod", roles: ["member", "link"] };
		const handlers = createHandlers(moderator, { storage, canEditLink: async () => false });

		const response = await handlers.object(
			new Request("https://example.com/api/uploads/key", { method: "DELETE" }),
			key,
		);

		expect(response.status).toBe(204);
		expect(storage.keys()).not.toContain(key);
	});
});

function imageForm(): FormData {
	const form = new FormData();
	form.set("purpose", "avatar");
	form.set("file", new File(["image"], "avatar.png", { type: "image/png" }));
	return form;
}

type HandlerOptions = {
	storage?: MemoryStorage;
	canEditLink?: (actor: Actor, linkId: string) => Promise<boolean>;
};

function createHandlers(actor: Actor | null, options: MemoryStorage | HandlerOptions = {}) {
	const storage = options instanceof MemoryStorage ? options : options.storage ?? new MemoryStorage();
	const canEditLink = options instanceof MemoryStorage ? async () => false : options.canEditLink ?? (async () => false);
	return createUploadHandlers({
		getActor: async () => actor,
		storage,
		canPostEvent: async () => true,
		canEditLink,
	});
}

class MemoryStorage implements StorageAdapter {
	readonly adapterType = "local-fs" as const;
	private readonly objects = new Map<string, { body: StorageBody; contentType?: string }>();

	async putObject(input: { key: string; body: StorageBody; contentType?: string }) {
		this.objects.set(input.key, { body: input.body, contentType: input.contentType });
		return { key: input.key };
	}

	async getObject(key: string) {
		const object = this.objects.get(key);
		return object ? { body: object.body as ReadableStream, contentType: object.contentType } : { body: null };
	}

	async deleteObject(key: string) {
		this.objects.delete(key);
	}

	keys() {
		return [...this.objects.keys()];
	}
}
