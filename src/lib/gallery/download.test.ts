import { afterEach, describe, expect, it, vi } from "vitest";
import { CFB } from "xlsx";
import { downloadGalleryZip } from "./download";

afterEach(() => vi.unstubAllGlobals());

describe("selected gallery download", () => {
	it("includes every selected original with unique safe filenames", async () => {
		vi.stubGlobal("fetch", async (url: string) => {
			if (url === "/api/uploads/gallery%2Fone%2Foriginal.jpg") return new Response(new Uint8Array([0, 255, 7]));
			if (url === "/api/uploads/gallery%2Ftwo%2Foriginal.jpg") return new Response(new Uint8Array([9, 8, 7]));
			return new Response(null, { status: 404 });
		});
		const blob = await downloadGalleryZip([
			{ fileKey: "gallery/one/original.jpg", originalName: "../photo.jpg" },
			{ fileKey: "gallery/two/original.jpg", originalName: "../photo.jpg" },
		]);
		expect(blob.type).toBe("application/zip");
		const data = new Uint8Array(await blob.arrayBuffer());
		expect([...data.slice(0, 4)]).toEqual([80, 75, 3, 4]);
		const zip = CFB.read(data, { type: "array" });
		expect([...CFB.find(zip, "1-.._photo.jpg").content]).toEqual([0, 255, 7]);
		expect([...CFB.find(zip, "2-.._photo.jpg").content]).toEqual([9, 8, 7]);
	});

	it("fails the download when any selected original cannot be read", async () => {
		vi.stubGlobal("fetch", async () => new Response(null, { status: 403 }));
		await expect(downloadGalleryZip([{ fileKey: "gallery/missing/original.jpg", originalName: "missing.jpg" }])).rejects.toThrow("Could not download");
	});
});
