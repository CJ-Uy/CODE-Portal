import { describe, expect, it, vi } from "vitest";

const { proxySharedApiRequest } = vi.hoisted(() => ({
	proxySharedApiRequest: vi.fn(async () => new Response(null, { status: 302 })),
}));

vi.mock("@/server/env", () => ({
	getAppConfig: () => ({ APP_ENV: "shared", APP_BASE_URL: "https://app.example" }),
}));

vi.mock("@/server/shared-api", () => ({ proxySharedApiRequest }));

vi.mock("@/db", () => ({
	getRepositories: vi.fn(async () => {
		throw new Error("shared mode should proxy");
	}),
}));

import { GET } from "./route";

describe("root short-link redirect route", () => {
	it("proxies shared mode redirects to the internal links redirect operation", async () => {
		const request = new Request("https://app.example/welcome");
		const response = await GET(request, { params: Promise.resolve({ slug: "welcome" }) });

		expect(response.status).toBe(302);
		expect(proxySharedApiRequest).toHaveBeenCalledWith(request, "/internal/links/redirect/welcome");
	});
});
