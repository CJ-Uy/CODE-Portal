import { afterEach, describe, expect, it, vi } from "vitest";

const { getAppConfig } = vi.hoisted(() => ({
	getAppConfig: vi.fn(() => ({
		SHARED_API_BASE_URL: "https://worker.example/base/",
		SHARED_API_TOKEN: "secret",
	})),
}));

vi.mock("@/server/env", () => ({ getAppConfig }));

import { proxySharedApiRequest } from "./shared-api";

describe("proxySharedApiRequest", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("preserves incoming query values while explicit target values win", async () => {
		const fetcher = vi.fn(async (input: RequestInfo | URL) => {
			void input;
			return new Response(null, { status: 204 });
		});
		vi.stubGlobal("fetch", fetcher);

		await proxySharedApiRequest(
			new Request("https://app.example/api/links/id/stats?source=qr&source=link&timezone=Asia%2FManila"),
			"/internal/links/id/stats?op=read",
		);
		const first = new URL(String(fetcher.mock.calls[0]?.[0]));
		expect(first.searchParams.getAll("source")).toEqual(["qr", "link"]);
		expect(first.searchParams.get("timezone")).toBe("Asia/Manila");

		await proxySharedApiRequest(
			new Request("https://app.example/api/events?op=client&from=2026-06-01"),
			"/internal/events?op=server",
		);
		const second = new URL(String(fetcher.mock.calls[1]?.[0]));
		expect(second.searchParams.getAll("op")).toEqual(["server"]);
		expect(second.searchParams.get("from")).toBe("2026-06-01");
	});
});
