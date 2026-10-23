export type StorageBody = ReadableStream | ArrayBuffer | Blob | string;

/** One byte range: `length` bytes from `offset` (to the end when omitted), or the last `suffix` bytes. */
export type StorageRange = { offset: number; length?: number } | { suffix: number };

export type StorageUploadedPart = { partNumber: number; etag: string };

export interface StorageAdapter {
	readonly adapterType: "r2-binding" | "r2-s3" | "local-fs" | "shared-api";

	putObject(input: {
		key: string;
		body: StorageBody;
		contentType?: string;
	}): Promise<{ key: string }>;

	getObject(key: string, options?: { range?: StorageRange }): Promise<{
		body: ReadableStream | null;
		contentType?: string;
		/** Bytes, when the backend reports them; callers omit Content-Length otherwise. */
		contentLength?: number;
		/** Set when a range was read: which bytes came back, and the whole object's size. */
		range?: { offset: number; length: number; size: number };
	}>;

	deleteObject(key: string): Promise<void>;

	/**
	 * Multipart uploads, for files larger than one Worker request can carry (the gallery). Only the R2 binding
	 * and the local filesystem have them; callers check before relying on them.
	 */
	createMultipartUpload?(key: string, contentType: string): Promise<{ uploadId: string }>;
	uploadPart?(key: string, uploadId: string, partNumber: number, body: ArrayBuffer): Promise<StorageUploadedPart>;
	completeMultipartUpload?(key: string, uploadId: string, parts: StorageUploadedPart[]): Promise<{ size: number }>;
	abortMultipartUpload?(key: string, uploadId: string): Promise<void>;
}
