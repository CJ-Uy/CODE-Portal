import { join, normalize } from "node:path";
import { getAppConfig } from "@/server/env";
import { arrayBufferToStream, bodyToArrayBuffer } from "../body";
import type { StorageAdapter, StorageUploadedPart } from "../types";

export class LocalFileStorageAdapter implements StorageAdapter {
	readonly adapterType = "local-fs" as const;

	private async pathForKey(key: string): Promise<string> {
		const config = getAppConfig();
		const root = normalize(config.LOCAL_STORAGE_DIR);
		const target = normalize(join(root, key));
		if (!target.startsWith(root)) {
			throw new Error("Invalid storage key.");
		}
		return target;
	}

	/** Parts of an unfinished multipart upload wait in a sibling directory named after the upload. */
	private async partsDir(key: string, uploadId: string): Promise<string> {
		if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new Error("Invalid upload id.");
		return `${await this.pathForKey(key)}.parts-${uploadId}`;
	}

	async putObject(input: Parameters<StorageAdapter["putObject"]>[0]): Promise<{ key: string }> {
		const fs = await import("node:fs/promises");
		const path = await this.pathForKey(input.key);
		await fs.mkdir((await import("node:path")).dirname(path), { recursive: true });
		await fs.writeFile(path, Buffer.from(await bodyToArrayBuffer(input.body)));
		if (input.contentType) {
			await fs.writeFile(`${path}.content-type`, input.contentType);
		}
		return { key: input.key };
	}

	async getObject(key: string, options?: Parameters<StorageAdapter["getObject"]>[1]): ReturnType<StorageAdapter["getObject"]> {
		const fs = await import("node:fs/promises");
		const path = await this.pathForKey(key);
		let buffer: Buffer;
		let contentType: string | undefined;
		try {
			[buffer, contentType] = await Promise.all([
				fs.readFile(path),
				fs.readFile(`${path}.content-type`, "utf8").catch(() => undefined),
			]);
		} catch {
			return { body: null };
		}
		const toStream = (bytes: Buffer) => arrayBufferToStream(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
		if (!options?.range) return { body: toStream(buffer), contentType, contentLength: buffer.byteLength };
		const size = buffer.byteLength;
		const range = options.range;
		const offset = "suffix" in range ? Math.max(0, size - range.suffix) : range.offset;
		if (offset >= size) throw new RangeError("Range not satisfiable.");
		const length = "suffix" in range ? size - offset : Math.min(range.length ?? size - offset, size - offset);
		return { body: toStream(buffer.subarray(offset, offset + length)), contentType, contentLength: length, range: { offset, length, size } };
	}

	async deleteObject(key: string): Promise<void> {
		const fs = await import("node:fs/promises");
		const path = await this.pathForKey(key);
		await Promise.all([
			fs.rm(path, { force: true }),
			fs.rm(`${path}.content-type`, { force: true }),
		]);
	}

	async createMultipartUpload(key: string, contentType: string) {
		const fs = await import("node:fs/promises");
		const uploadId = crypto.randomUUID();
		const dir = await this.partsDir(key, uploadId);
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(join(dir, "content-type"), contentType);
		return { uploadId };
	}

	async uploadPart(key: string, uploadId: string, partNumber: number, body: ArrayBuffer): Promise<StorageUploadedPart> {
		const fs = await import("node:fs/promises");
		const dir = await this.partsDir(key, uploadId);
		await fs.access(dir);
		await fs.writeFile(join(dir, String(partNumber)), Buffer.from(body));
		return { partNumber, etag: `local-${partNumber}-${body.byteLength}` };
	}

	async completeMultipartUpload(key: string, uploadId: string, parts: StorageUploadedPart[]) {
		const fs = await import("node:fs/promises");
		const dir = await this.partsDir(key, uploadId);
		const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
		const bytes = Buffer.concat(await Promise.all(ordered.map((part) => fs.readFile(join(dir, String(part.partNumber))))));
		const contentType = await fs.readFile(join(dir, "content-type"), "utf8");
		await this.putObject({ key, body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, contentType });
		await fs.rm(dir, { recursive: true, force: true });
		return { size: bytes.byteLength };
	}

	async abortMultipartUpload(key: string, uploadId: string) {
		const fs = await import("node:fs/promises");
		await fs.rm(await this.partsDir(key, uploadId), { recursive: true, force: true });
	}
}
