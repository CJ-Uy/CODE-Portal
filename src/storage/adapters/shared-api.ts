import { getAppConfig } from "@/server/env";
import type { StorageAdapter } from "../types";

export class SharedApiStorageAdapter implements StorageAdapter {
	readonly adapterType = "shared-api" as const;

	private request(path: string, init?: RequestInit): Promise<Response> {
		const config = getAppConfig();
		if (!config.SHARED_API_BASE_URL || !config.SHARED_API_TOKEN) {
			throw new Error("Shared API configuration is missing.");
		}

		return fetch(new URL(path, config.SHARED_API_BASE_URL), {
			...init,
			headers: {
				Authorization: `Bearer ${config.SHARED_API_TOKEN}`,
				...init?.headers,
			},
		});
	}

	async putObject(input: Parameters<StorageAdapter["putObject"]>[0]): Promise<{ key: string }> {
		void input;
		throw new Error("Shared uploads must use the authenticated upload endpoint so the server can assign the object key.");
	}

	async getObject(key: string): Promise<{ body: ReadableStream | null; contentType?: string }> {
		const response = await this.request(`/internal/uploads/${encodeURIComponent(key)}`);
		if (response.status === 404) return { body: null };
		if (!response.ok) throw new Error("Shared API failed to read upload.");
		return {
			body: response.body,
			contentType: response.headers.get("content-type") ?? undefined,
		};
	}

	async deleteObject(key: string): Promise<void> {
		void key;
		throw new Error("Shared development does not allow destructive storage operations.");
	}
}
