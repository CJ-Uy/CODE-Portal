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

	async getObject(key: string): ReturnType<StorageAdapter["getObject"]> {
		const object = await this.bucket().get(key);
		return {
			body: object?.body ?? null,
			contentType: object?.httpMetadata?.contentType,
			contentLength: object?.size,
		};
	}

	async deleteObject(key: string): Promise<void> {
		await this.bucket().delete(key);
	}
}
