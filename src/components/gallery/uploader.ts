import { readExifDate } from "@/lib/gallery/exif";

const ENDPOINT = "/api/gallery/uploads";
const VIDEO_NAME = /\.(mp4|m4v|mov|qt|webm)$/i;

export type UploadOptions = {
	folderId: string | null;
	onProgress(fraction: number): void;
	signal?: AbortSignal;
};

async function errorOf(response: Response, fallback: string): Promise<Error> {
	const body = (await response.json().catch(() => null)) as { error?: string } | null;
	return new Error(body?.error ?? fallback);
}

/**
 * Uploads one file to the gallery: reserve a key, send it in parts (each retried up to three times),
 * then complete it with the date taken and, for a video, a poster frame grabbed here in the browser.
 */
export async function uploadGalleryFile(file: File, options: UploadOptions): Promise<void> {
	const isVideo = file.type.startsWith("video/") || VIDEO_NAME.test(file.name);
	const [takenAt, video] = await Promise.all([dateTaken(file), isVideo ? posterFrame(file) : Promise.resolve(null)]);

	const created = await fetch(`${ENDPOINT}?action=create`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
		signal: options.signal,
	});
	if (!created.ok) throw await errorOf(created, "The upload could not start.");
	const { key, uploadId, partBytes } = (await created.json()) as { key: string; uploadId: string; partBytes: number };

	try {
		const parts: { partNumber: number; etag: string }[] = [];
		const partCount = Math.max(1, Math.ceil(file.size / partBytes));
		for (let index = 0; index < partCount; index++) {
			const blob = file.slice(index * partBytes, Math.min(file.size, (index + 1) * partBytes));
			const url = `${ENDPOINT}?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&part=${index + 1}`;
			parts.push(await withRetries(() => putPart(url, blob, (sent) => options.onProgress((index * partBytes + sent) / Math.max(1, file.size)), options.signal)));
		}

		const form = new FormData();
		form.set("key", key);
		form.set("uploadId", uploadId);
		form.set("parts", JSON.stringify(parts));
		form.set("name", file.name);
		if (options.folderId) form.set("folderId", options.folderId);
		if (takenAt) form.set("takenAt", String(takenAt.getTime()));
		if (video?.duration) form.set("durationSeconds", String(video.duration));
		if (video?.poster) form.set("poster", video.poster, "poster.jpg");
		const completed = await fetch(`${ENDPOINT}?action=complete`, { method: "POST", body: form, signal: options.signal });
		if (!completed.ok) throw await errorOf(completed, "The upload could not be saved.");
		options.onProgress(1);
	} catch (error) {
		// Free the parts already stored; R2 would also drop them by itself after 7 days.
		void fetch(`${ENDPOINT}?action=abort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, uploadId }) }).catch(() => undefined);
		throw error;
	}
}

class PartError extends Error {
	constructor(message: string, readonly retry: boolean) {
		super(message);
	}
}

/** XHR rather than fetch, for upload progress within a part. */
function putPart(url: string, blob: Blob, onSent: (bytes: number) => void, signal?: AbortSignal): Promise<{ partNumber: number; etag: string }> {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open("PUT", url);
		request.upload.onprogress = (event) => onSent(event.loaded);
		request.onload = () => {
			const body = (() => {
				try {
					return JSON.parse(request.responseText) as { partNumber: number; etag: string; error?: string };
				} catch {
					return null;
				}
			})();
			if (request.status >= 200 && request.status < 300 && body) resolve(body);
			else reject(new PartError(body?.error ?? "A part failed to upload.", request.status >= 500 || request.status === 0));
		};
		request.onerror = () => reject(new PartError("The connection dropped.", true));
		signal?.addEventListener("abort", () => request.abort());
		request.onabort = () => reject(new DOMException("Upload cancelled.", "AbortError"));
		request.send(blob);
	});
}

async function withRetries<T>(attempt: () => Promise<T>): Promise<T> {
	for (let tries = 1; ; tries++) {
		try {
			return await attempt();
		} catch (error) {
			if (!(error instanceof PartError) || !error.retry || tries >= 3) throw error;
			await new Promise((resolve) => setTimeout(resolve, 1000 * tries));
		}
	}
}

/** EXIF for JPEGs (phones pick photos with lastModified set to the moment of picking); the file's own date otherwise. */
async function dateTaken(file: File): Promise<Date | null> {
	if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) {
		const fromExif = readExifDate(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
		if (fromExif) return fromExif;
	}
	return file.lastModified ? new Date(file.lastModified) : null;
}

/**
 * A JPEG frame from about a second in, at most 640 wide, plus the duration. Null pieces when this browser cannot
 * decode the video (HEVC on most non-Apple browsers); the gallery then shows a plain video tile.
 */
function posterFrame(file: File): Promise<{ poster: Blob | null; duration: number | null } | null> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement("video");
		let duration: number | null = null;
		const finish = (poster: Blob | null) => {
			clearTimeout(timer);
			URL.revokeObjectURL(url);
			video.removeAttribute("src");
			resolve({ poster, duration });
		};
		const timer = setTimeout(() => finish(null), 10_000);
		video.muted = true;
		video.playsInline = true;
		video.preload = "metadata";
		video.onloadedmetadata = () => {
			duration = Number.isFinite(video.duration) ? video.duration : null;
			video.currentTime = Math.min(1, (duration ?? 2) / 10);
		};
		video.onseeked = () => {
			const scale = Math.min(1, 640 / (video.videoWidth || 640));
			const canvas = document.createElement("canvas");
			canvas.width = Math.round((video.videoWidth || 640) * scale);
			canvas.height = Math.round((video.videoHeight || 360) * scale);
			canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
			canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.8);
		};
		video.onerror = () => finish(null);
		video.src = url;
	});
}
