import { galleryFileUrl } from "./view";

export async function downloadGalleryZip(items: { fileKey: string; originalName: string }[]): Promise<Blob> {
	const { CFB } = await import("xlsx");
	const archive = CFB.utils.cfb_new();
	// shortcut: ZIPs use browser memory; stream exports if large video batches become common.
	for (const [index, item] of items.entries()) {
		const response = await fetch(galleryFileUrl(item.fileKey));
		if (!response.ok) throw new Error(`Could not download ${item.originalName}. Try again.`);
		const data = new Uint8Array(await response.arrayBuffer());
		if (!data.length) throw new Error(`Could not download ${item.originalName}. Try again.`);
		// The installed ZIP writer uses ASCII filenames; numbering keeps duplicate names distinct.
		const name = item.originalName.replace(/[^\x20-\x7E]|[\\/:*?"<>|]/g, "_") || "photo";
		CFB.utils.cfb_add(archive, `${index + 1}-${name}`, data);
	}
	return new Blob([new Uint8Array(CFB.write(archive, { type: "array", fileType: "zip" }))], { type: "application/zip" });
}
