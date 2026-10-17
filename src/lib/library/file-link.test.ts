import { describe, expect, it } from "vitest";
import { filePreview, formatFileSize, libraryFileHref } from "./file-link";

describe("libraryFileHref", () => {
	const file = { key: "library/lib_1/mem_1/a1b2.pdf", name: "Org Design v2.pdf" };

	it("passes the stored file name, encoded, and never the title", () => {
		expect(libraryFileHref(file)).toBe("/api/uploads/library%2Flib_1%2Fmem_1%2Fa1b2.pdf?name=Org+Design+v2.pdf");
	});

	it("adds download=1 for the download link", () => {
		expect(libraryFileHref(file, { download: true })).toBe("/api/uploads/library%2Flib_1%2Fmem_1%2Fa1b2.pdf?download=1&name=Org+Design+v2.pdf");
	});

	it("falls back to the key's last segment when no name was stored", () => {
		expect(libraryFileHref({ key: file.key, name: null })).toContain("name=a1b2.pdf");
		expect(libraryFileHref({ key: file.key, name: "  " })).toContain("name=a1b2.pdf");
	});

	it("encodes characters that would end the query", () => {
		const href = libraryFileHref({ key: file.key, name: "A&B #1?.pdf" });
		expect(new URL(href, "https://x.test").searchParams.get("name")).toBe("A&B #1?.pdf");
	});
});

describe("filePreview", () => {
	it("tells the preview kind from the key's extension", () => {
		expect(filePreview({ key: "library/i/m/x.PDF" })).toBe("pdf");
		expect(filePreview({ key: "library/i/m/x.docx" })).toBe("word");
		expect(filePreview({ key: "library/i/m/x.pptx" })).toBe("powerpoint");
		expect(filePreview({ key: "library/i/m/x.xlsx" })).toBe("excel");
		expect(filePreview({ key: "library/i/m/x.zip" })).toBe("other");
		expect(filePreview({ key: "library/i/m/noextension" })).toBe("other");
	});
});

describe("formatFileSize", () => {
	it("is short and empty when unknown", () => {
		expect(formatFileSize(null)).toBe("");
		expect(formatFileSize(0)).toBe("");
		expect(formatFileSize(900)).toBe("900 B");
		expect(formatFileSize(2048)).toBe("2 KB");
		expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
	});
});
