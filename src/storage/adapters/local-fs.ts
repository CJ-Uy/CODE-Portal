import { join, normalize } from "node:path";
import { getAppConfig } from "@/server/env";
import { arrayBufferToStream, bodyToArrayBuffer } from "../body";
import type { StorageAdapter } from "../types";

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

	async getObject(key: string): ReturnType<StorageAdapter["getObject"]> {
		const fs = await import("node:fs/promises");
		const path = await this.pathForKey(key);
		try {
			const [buffer, contentType] = await Promise.all([
				fs.readFile(path),
				fs.readFile(`${path}.content-type`, "utf8").catch(() => undefined),
			]);
			return { body: arrayBufferToStream(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)), contentType, contentLength: buffer.byteLength };
		} catch {
			return { body: null };
		}
	}

	async deleteObject(key: string): Promise<void> {
		const fs = await import("node:fs/promises");
		const path = await this.pathForKey(key);
		await Promise.all([
			fs.rm(path, { force: true }),
			fs.rm(`${path}.content-type`, { force: true }),
		]);
	}
}
