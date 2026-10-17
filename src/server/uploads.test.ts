import { describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import type { StorageAdapter, StorageBody } from "@/storage/types";
import { createUploadHandlers, MAX_UPLOAD_BYTES } from "./uploads";

const memberActor: Actor = { memberId: "mem_upload", roles: ["member"] };

describe("upload handlers", () => {
	it("restricts email images to email admins and serves their images to signed-out recipients", async () => {
		const form = imageForm(); form.set("purpose", "email_image");
		const request = () => new Request("https://example.com/api/uploads", { method: "POST", body: form });
		expect((await createHandlers(memberActor).collection(request())).status).toBe(403);
		const storage = new MemoryStorage();
		const response = await createHandlers({ memberId: "mem_email", roles: ["email"] }, storage).collection(request());
		expect(response.status).toBe(201);
		const { key } = await response.json() as { key: string };
		expect(key).toMatch(/^email-images\/mem_email\/[a-z0-9_-]+\.png$/);
		expect((await createHandlers(null, storage).object(new Request("https://example.com/api/uploads/key"), key)).status).toBe(200);
		expect((await createHandlers(memberActor, storage).object(new Request("https://example.com/api/uploads/key", { method: "DELETE" }), key)).status).toBe(403);
	});
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

const MB = 1024 * 1024;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const libraryMember: Actor = { memberId: "m1", roles: ["member"] };
const libraryManager: Actor = { memberId: "mgr", roles: ["publishing"] };
const pdfKey = "library/lib_1/m1/lfile_x.pdf";

const pdfFile = () => new File([new TextEncoder().encode("%PDF-1.7 test")], "a.pdf", { type: "application/pdf" });
const zipFile = (type: string, name: string) => new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])], name, { type });
const pngFile = (bytes = 8) => new File([new Uint8Array(bytes)], "a.png", { type: "image/png" });

function upload(
	fields: Record<string, string | File>,
	options: HandlerOptions & { actor?: Actor | null; headers?: Record<string, string> } = {},
) {
	const { actor = libraryMember, headers, ...handlerOptions } = options;
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.set(name, value);
	return createHandlers(actor, handlerOptions).collection(
		new Request("https://example.com/api/uploads", { method: "POST", body: form, headers }),
	);
}

function get(path: string, method = "GET") {
	return new Request(`https://example.com/api/uploads/${path}`, { method });
}

async function seededStorage(key = pdfKey, contentType = "application/pdf", body = "%PDF-1.7 test") {
	const storage = new MemoryStorage();
	await storage.putObject({ key, body, contentType });
	return storage;
}

describe("library uploads", () => {
	it("accepts a real PDF for an editable item and rejects a renamed exe", async () => {
		const storage = new MemoryStorage();
		const res = await upload({ purpose: "library_file", itemId: "lib_1", file: pdfFile() }, { storage });
		expect(res.status).toBe(201);
		const { key } = await res.json() as { key: string };
		expect(key).toMatch(/^library\/lib_1\/m1\/lfile_[a-z0-9]+\.pdf$/);
		expect(storage.keys()).toEqual([key]);

		const fake = new File([new Uint8Array([0x4d, 0x5a, 0x90])], "a.pdf", { type: "application/pdf" });
		expect((await upload({ purpose: "library_file", itemId: "lib_1", file: fake }, { storage })).status).toBe(415);
		expect(storage.keys()).toEqual([key]);
	});

	it.each([
		[DOCX, "docx"],
		[PPTX, "pptx"],
		[XLSX, "xlsx"],
	])("accepts %s with a zip header and rejects it without one", async (type, extension) => {
		const ok = await upload({ purpose: "library_file", itemId: "lib_1", file: zipFile(type, `a.${extension}`) });
		expect(ok.status).toBe(201);
		expect((await ok.json() as { key: string }).key).toMatch(new RegExp(`^library/lib_1/m1/lfile_[a-z0-9]+\\.${extension}$`));

		const noHeader = new File([new TextEncoder().encode("not a zip")], `a.${extension}`, { type });
		expect((await upload({ purpose: "library_file", itemId: "lib_1", file: noHeader })).status).toBe(415);
		// a PDF payload does not pass as an Office file either
		const pdfAsOffice = new File([new TextEncoder().encode("%PDF-1.7")], `a.${extension}`, { type });
		expect((await upload({ purpose: "library_file", itemId: "lib_1", file: pdfAsOffice })).status).toBe(415);
	});

	it("rejects a ZIP-headed file that claims to be a PDF", async () => {
		const res = await upload({ purpose: "library_file", itemId: "lib_1", file: zipFile("application/pdf", "a.pdf") });
		expect(res.status).toBe(415);
	});

	it("accepts library images and refuses non-image or non-document types per purpose", async () => {
		const image = await upload({ purpose: "library_image", itemId: "lib_1", file: pngFile() });
		expect(image.status).toBe(201);
		expect((await image.json() as { key: string }).key).toMatch(/^library\/lib_1\/m1\/limg_[a-z0-9]+\.png$/);

		expect((await upload({ purpose: "library_image", itemId: "lib_1", file: pdfFile() })).status).toBe(415);
		expect((await upload({ purpose: "library_file", itemId: "lib_1", file: pngFile() })).status).toBe(415);
		const text = new File(["hello"], "a.txt", { type: "text/plain" });
		expect((await upload({ purpose: "library_file", itemId: "lib_1", file: text })).status).toBe(415);
	});

	it("rejects library uploads over 50 MB and images over 10 MB", async () => {
		const header = (megabytes: number) => ({ "content-length": String(megabytes * MB) });
		expect((await upload({ purpose: "library_file", itemId: "lib_1", file: pdfFile() }, { headers: header(51) })).status).toBe(413);
		expect((await upload({ purpose: "library_file", itemId: "lib_1", file: pdfFile() }, { headers: header(60) })).status).toBe(413);
		const bigPng = pngFile(10 * MB + 1);
		expect((await upload({ purpose: "library_image", itemId: "lib_1", file: bigPng })).status).toBe(413);
	});

	it("rejects a PDF body over 50 MB when no content-length announces it", async () => {
		const big = new File([new Uint8Array(50 * MB + 1)], "big.pdf", { type: "application/pdf" });
		expect((await upload({ purpose: "library_file", itemId: "lib_1", file: big })).status).toBe(413);
	}, 30_000);

	it("sizes the limit by purpose: 10 MB for library images, still 5 MB for avatars", async () => {
		expect((await upload({ purpose: "library_image", itemId: "lib_1", file: pngFile(6 * MB) })).status).toBe(201);
		expect((await upload({ purpose: "avatar", file: pngFile(6 * MB) })).status).toBe(413);
	});

	it("rejects uploads to items the actor cannot edit and passes the actor and item to the check", async () => {
		const storage = new MemoryStorage();
		const canEditLibraryItem = vi.fn(async () => false);
		const res = await upload({ purpose: "library_file", itemId: "lib_other", file: pdfFile() }, { storage, canEditLibraryItem });
		expect(res.status).toBe(403);
		expect(canEditLibraryItem).toHaveBeenCalledWith(libraryMember, "lib_other");
		expect(storage.keys()).toEqual([]);
	});

	it.each(["library_file", "library_image"])("requires a safe itemId for %s", async (purpose) => {
		const canEditLibraryItem = vi.fn(async () => true);
		const file = purpose === "library_file" ? pdfFile() : pngFile();
		expect((await upload({ purpose, file }, { canEditLibraryItem })).status).toBe(400);
		for (const itemId of ["", "..", "a/b", "../x", "a b"]) {
			expect((await upload({ purpose, itemId, file }, { canEditLibraryItem })).status).toBe(400);
		}
		expect(canEditLibraryItem).not.toHaveBeenCalled();
	});

	it("requires authentication and still rejects unknown purposes", async () => {
		expect((await upload({ purpose: "library_file", itemId: "lib_1", file: pdfFile() }, { actor: null })).status).toBe(401);
		expect((await upload({ purpose: "nope", file: pngFile() })).status).toBe(400);
	});
});

describe("library file access", () => {
	it("serves library files only to members who can read the item", async () => {
		const storage = await seededStorage();
		const denied = vi.fn(async () => false);
		const res = await createHandlers(libraryMember, { storage, canReadLibraryObject: denied }).object(get(pdfKey), pdfKey);
		expect(res.status).toBe(404);
		expect(denied).toHaveBeenCalledWith(libraryMember, "lib_1");

		const allowed = await createHandlers(libraryMember, storage).object(get(pdfKey), pdfKey);
		expect(allowed.status).toBe(200);
		expect(allowed.headers.get("content-type")).toBe("application/pdf");
		expect(new TextDecoder().decode(await allowed.arrayBuffer())).toBe("%PDF-1.7 test");
	});

	it("requires a signed-in member before touching storage or the item check", async () => {
		const canReadLibraryObject = vi.fn(async () => true);
		const res = await createHandlers(null, { storage: await seededStorage(), canReadLibraryObject }).object(get(pdfKey), pdfKey);
		expect(res.status).toBe(401);
		expect(canReadLibraryObject).not.toHaveBeenCalled();
	});

	it("returns 404 for a missing object and for keys of any other shape", async () => {
		const canReadLibraryObject = vi.fn(async () => true);
		const handlers = createHandlers(libraryMember, { storage: await seededStorage(), canReadLibraryObject });
		const keys = ["library/lib_1/m1/missing.pdf", "library/a/b", "library/../x/y", "library/a/../y/z", "library/a/b/c/d", "library//b/c", "library/a/b/c d"];
		for (const key of keys) expect((await handlers.object(get(key), key)).status).toBe(404);
		expect(canReadLibraryObject).toHaveBeenCalledTimes(1); // only the well-formed missing key reached the item check
	});

	it("sets inline disposition for PDFs and attachment for downloads", async () => {
		const storage = await seededStorage();
		const res = await createHandlers(libraryMember, storage).object(get(`${pdfKey}?name=Module%201.pdf`), pdfKey);
		expect(res.headers.get("content-disposition")).toBe('inline; filename="Module 1.pdf"');
		expect(res.headers.get("content-length")).toBe("13");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		const dl = await createHandlers(libraryMember, storage).object(get(`${pdfKey}?download=1`), pdfKey);
		expect(dl.headers.get("content-disposition")).toMatch(/^attachment/);
	});

	it("shows images inline, forces Office files to download, and defaults the filename to the key basename", async () => {
		const png = "library/lib_1/m1/limg_x.png";
		const docx = "library/lib_1/m1/lfile_y.docx";
		const storage = new MemoryStorage();
		await storage.putObject({ key: png, body: "png", contentType: "image/png" });
		await storage.putObject({ key: docx, body: "PK", contentType: DOCX });
		const handlers = createHandlers(libraryMember, storage);

		expect((await handlers.object(get(png), png)).headers.get("content-disposition")).toBe('inline; filename="limg_x.png"');
		expect((await handlers.object(get(docx), docx)).headers.get("content-disposition")).toBe('attachment; filename="lfile_y.docx"');
		expect((await handlers.object(get(`${docx}?name=Brief.docx&download=1`), docx)).headers.get("content-disposition")).toBe('attachment; filename="Brief.docx"');
	});

	it("sanitizes the filename: quotes, backslashes, control characters and non-ASCII", async () => {
		const storage = await seededStorage();
		const name = encodeURIComponent('a"b\\c\r\nd é\u{1F600}.pdf');
		const res = await createHandlers(libraryMember, storage).object(get(`${pdfKey}?name=${name}`), pdfKey);
		expect(res.headers.get("content-disposition")).toBe('inline; filename="abc__d __.pdf"');
		const blank = await createHandlers(libraryMember, storage).object(get(`${pdfKey}?name=%22%22`), pdfKey);
		expect(blank.headers.get("content-disposition")).toBe('inline; filename="lfile_x.pdf"');
	});

	it("allows only library:manage to delete library objects, not the uploader", async () => {
		const storage = await seededStorage();
		const uploader = await createHandlers(libraryMember, storage).object(get(pdfKey, "DELETE"), pdfKey);
		expect(uploader.status).toBe(403);
		expect(storage.keys()).toEqual([pdfKey]);

		const manager = await createHandlers(libraryManager, storage).object(get(pdfKey, "DELETE"), pdfKey);
		expect(manager.status).toBe(204);
		expect(storage.keys()).toEqual([]);
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
	canEditLibraryItem?: (actor: Actor, itemId: string) => Promise<boolean>;
	canReadLibraryObject?: (actor: Actor, itemId: string) => Promise<boolean>;
};

function createHandlers(actor: Actor | null, options: MemoryStorage | HandlerOptions = {}) {
	const storage = options instanceof MemoryStorage ? options : options.storage ?? new MemoryStorage();
	const canEditLink = options instanceof MemoryStorage ? async () => false : options.canEditLink ?? (async () => false);
	return createUploadHandlers({
		getActor: async () => actor,
		storage,
		canPostEvent: async () => true,
		canEditLink,
		canEditLibraryItem: options instanceof MemoryStorage ? async () => true : options.canEditLibraryItem ?? (async () => true),
		canReadLibraryObject: options instanceof MemoryStorage ? async () => true : options.canReadLibraryObject ?? (async () => true),
	});
}

function sizeOf(body: StorageBody): number | undefined {
	if (typeof body === "string") return new TextEncoder().encode(body).byteLength;
	if (body instanceof Blob) return body.size;
	if (body instanceof ArrayBuffer) return body.byteLength;
	return undefined;
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
		return object
			? { body: object.body as ReadableStream, contentType: object.contentType, contentLength: sizeOf(object.body) }
			: { body: null };
	}

	async deleteObject(key: string) {
		this.objects.delete(key);
	}

	keys() {
		return [...this.objects.keys()];
	}
}
