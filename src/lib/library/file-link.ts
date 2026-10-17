export type FilePreview = "pdf" | "word" | "powerpoint" | "excel" | "other";

const BY_EXTENSION: Record<string, FilePreview> = { pdf: "pdf", doc: "word", docx: "word", ppt: "powerpoint", pptx: "powerpoint", xls: "excel", xlsx: "excel" };

const tail = (value: string) => value.slice(value.lastIndexOf("/") + 1);

/**
 * `/api/uploads/<key>` for a stored library file. `?name=` must be the stored file name (it has the extension), never
 * the item's title: a title with a dot in it would lose its tail as a fake extension. A missing name falls back to the key's last segment.
 */
export function libraryFileHref(file: { key: string; name?: string | null }, options: { download?: boolean } = {}): string {
	const params = new URLSearchParams();
	if (options.download) params.set("download", "1");
	params.set("name", file.name?.trim() || tail(file.key));
	return `/api/uploads/${encodeURIComponent(file.key)}?${params}`;
}

/** What the item page shows for a file. The upload route pinned the key's extension to the verified type, so the key decides. */
export function filePreview(file: { key: string }): FilePreview {
	const name = tail(file.key);
	return BY_EXTENSION[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "other";
}

export function formatFileSize(bytes: number | null | undefined): string {
	if (!bytes || bytes < 0 || !Number.isFinite(bytes)) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
