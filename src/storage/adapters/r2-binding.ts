import { getCloudflareEnv } from "@/server/cloudflare";
import type { StorageAdapter } from "../types";

export class R2BindingStorageAdapter implements StorageAdapter {
	readonly adapterType = "r2-binding" as const;

	private bucket(): R2Bucket {
		const env = getCloudflareEnv();
		if (!env.BUCKET) {
			throw new Error("Cloudflare R2 binding BUCKET is unavailable.");
		}
		return env.BUCKET;
	}

	async putObject(input: Parameters<StorageAdapter["putObject"]>[0]): Promise<{ key: string }> {
		await this.bucket().put(input.key, input.body, {
			httpMetadata: input.contentType ? { contentType: input.contentType } : undefined,
		});
		return { key: input.key };
	}

	async getObject(key: string, options?: Parameters<StorageAdapter["getObject"]>[1]): ReturnType<StorageAdapter["getObject"]> {
		const object = await this.bucket().get(key, options?.range ? { range: options.range } : undefined);
		if (!object) return { body: null };
		// A ranged read reports the bytes it returned in `range`; size is always the whole object.
		const range = options?.range && object.range && "offset" in object.range ? { offset: object.range.offset ?? 0, length: object.range.length ?? object.size, size: object.size } : undefined;
		return {
			body: object.body,
			contentType: object.httpMetadata?.contentType,
			contentLength: range ? range.length : object.size,
			range,
		};
	}

	async deleteObject(key: string): Promise<void> {
		await this.bucket().delete(key);
	}

	async createMultipartUpload(key: string, contentType: string) {
		const upload = await this.bucket().createMultipartUpload(key, { httpMetadata: { contentType } });
		return { uploadId: upload.uploadId };
	}

	async uploadPart(key: string, uploadId: string, partNumber: number, body: ArrayBuffer) {
		const part = await this.bucket().resumeMultipartUpload(key, uploadId).uploadPart(partNumber, body);
		return { partNumber: part.partNumber, etag: part.etag };
	}

	async completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
		const object = await this.bucket().resumeMultipartUpload(key, uploadId).complete(parts);
		return { size: object.size };
	}

	async abortMultipartUpload(key: string, uploadId: string) {
		await this.bucket().resumeMultipartUpload(key, uploadId).abort();
	}
}
