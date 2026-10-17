import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getAppConfig } from "@/server/env";
import { bodyToArrayBuffer } from "../body";
import type { StorageAdapter } from "../types";

export class R2S3StorageAdapter implements StorageAdapter {
	readonly adapterType = "r2-s3" as const;
	private clientInstance: S3Client | null = null;

	private client(): S3Client {
		if (this.clientInstance) return this.clientInstance;
		const config = getAppConfig();
		this.clientInstance = new S3Client({
			region: "auto",
			endpoint: config.R2_ENDPOINT,
			credentials: {
				accessKeyId: config.R2_ACCESS_KEY_ID ?? "",
				secretAccessKey: config.R2_SECRET_ACCESS_KEY ?? "",
			},
		});
		return this.clientInstance;
	}

	async putObject(input: Parameters<StorageAdapter["putObject"]>[0]): Promise<{ key: string }> {
		const config = getAppConfig();
		await this.client().send(new PutObjectCommand({
			Bucket: config.R2_BUCKET_NAME,
			Key: input.key,
			Body: Buffer.from(await bodyToArrayBuffer(input.body)),
			ContentType: input.contentType,
		}));
		return { key: input.key };
	}

	async getObject(key: string): ReturnType<StorageAdapter["getObject"]> {
		const config = getAppConfig();
		const response = await this.client().send(new GetObjectCommand({
			Bucket: config.R2_BUCKET_NAME,
			Key: key,
		}));
		return {
			body: response.Body?.transformToWebStream() ?? null,
			contentType: response.ContentType,
			contentLength: response.ContentLength,
		};
	}

	async deleteObject(key: string): Promise<void> {
		const config = getAppConfig();
		await this.client().send(new DeleteObjectCommand({
			Bucket: config.R2_BUCKET_NAME,
			Key: key,
		}));
	}
}
