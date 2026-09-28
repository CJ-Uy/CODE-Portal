import { describe, expect, it, vi } from "vitest";
import { LinkRepositoryError } from "@/db/repositories/links";
import type { Actor } from "@/server/auth/permissions";
import { createLinksHandlers } from "./handlers";

const owner: Actor = { memberId: "mem_owner", roles: ["member"] };

function depsWith(overrides: Record<string, unknown>) {
	const repo = {
		searchVisible: vi.fn(async () => ({ links: [], total: 0, tags: [] })),
		listVisible: vi.fn(async () => []),
		listOwn: vi.fn(async () => []),
		listAll: vi.fn(async () => []),
		getById: vi.fn(async () => null),
		create: vi.fn(async () => ({ id: "lnk_1", slug: "welcome" })),
		update: vi.fn(async () => ({ id: "lnk_1", slug: "welcome", title: "Updated" })),
		remove: vi.fn(async () => {}),
		getStats: vi.fn(async () => ({ link: { id: "lnk_1" }, series: [], hourly: [], referrers: [], devices: [] })),
		...overrides,
	};
	return {
		getActor: async () => owner as Actor | null,
		getRepositories: async () => ({ links: repo }) as never,
		repo,
	};
}

describe("links handlers", () => {
	it("rejects an unauthenticated collection request", async () => {
		const deps = depsWith({});
		const handlers = createLinksHandlers({ getActor: async () => null, getRepositories: deps.getRepositories });
		const res = await handlers.collection(new Request("https://app/api/links", { method: "GET" }));
		expect(res.status).toBe(401);
	});

	it("lists visible links by default and own links when scoped", async () => {
		const deps = depsWith({});
		const handlers = createLinksHandlers(deps);

		await handlers.collection(new Request("https://app/api/links", { method: "GET" }));
		await handlers.collection(new Request("https://app/api/links?scope=own", { method: "GET" }));

		expect(deps.repo.listVisible).toHaveBeenCalledOnce();
		expect(deps.repo.listOwn).toHaveBeenCalledOnce();
	});

	it("passes pagination and filters to the full-list search", async () => {
		const deps = depsWith({});
		const handlers = createLinksHandlers(deps);
		const res = await handlers.collection(new Request("https://app/api/links?scope=search&limit=25&offset=25&query=Gamma&own=true&tag=older&sort=title&direction=asc"));
		expect(res.status).toBe(200);
		expect(deps.repo.searchVisible).toHaveBeenCalledWith(owner, {
			limit: 25, offset: 25, query: "Gamma", own: true, tags: ["older"], sort: "title", direction: "asc",
		});
	});

	it("creates a link from a POST body", async () => {
		const deps = depsWith({});
		const handlers = createLinksHandlers(deps);
		const res = await handlers.collection(
			new Request("https://app/api/links", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ slug: "welcome", destinationUrl: "https://example.com", title: "Welcome" }),
			}),
		);
		expect(res.status).toBe(201);
		expect(deps.repo.create).toHaveBeenCalledOnce();
	});

	it("returns 403 when the repository rejects on authorization", async () => {
		const deps = depsWith({
			update: vi.fn(async () => {
				throw new LinkRepositoryError("not_authorized", "Not authorized to access this link.");
			}),
		});
		const handlers = createLinksHandlers(deps);
		const res = await handlers.item(
			new Request("https://app/api/links/lnk_1", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: "x" }),
			}),
			"lnk_1",
		);
		expect(res.status).toBe(403);
	});

	it("returns 404 when the repository reports a missing link", async () => {
		const deps = depsWith({
			update: vi.fn(async () => {
				throw new LinkRepositoryError("not_found", "Link not found.");
			}),
		});
		const handlers = createLinksHandlers(deps);
		const res = await handlers.item(
			new Request("https://app/api/links/missing", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: "x" }),
			}),
			"missing",
		);
		expect(res.status).toBe(404);
	});

	it("deletes via the item handler", async () => {
		const deps = depsWith({});
		const handlers = createLinksHandlers(deps);
		const res = await handlers.item(new Request("https://app/api/links/lnk_1", { method: "DELETE" }), "lnk_1");
		expect(res.status).toBe(204);
		expect(deps.repo.remove).toHaveBeenCalledWith(owner, "lnk_1");
	});

	it("validates and forwards analytics filters", async () => {
		const deps = depsWith({});
		const handlers = createLinksHandlers(deps);
		const res = await handlers.stats(
			new Request("https://app/api/links/lnk_1/stats?from=2026-06-01&to=2026-06-30&timezone=Asia%2FManila&granularity=week&source=qr&device=mobile"),
			"lnk_1",
		);
		expect(res.status).toBe(200);
		expect(deps.repo.getStats).toHaveBeenCalledWith(owner, "lnk_1", {
			from: "2026-06-01",
			to: "2026-06-30",
			timezone: "Asia/Manila",
			granularity: "week",
			source: "qr",
			device: "mobile",
		});
	});

	it("returns the first actionable analytics validation issue", async () => {
		const deps = depsWith({});
		const handlers = createLinksHandlers(deps);
		const res = await handlers.stats(
			new Request("https://app/api/links/lnk_1/stats?timezone=Mars%2FOlympus"),
			"lnk_1",
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "Timezone must be a valid IANA timezone." });
		expect(deps.repo.getStats).not.toHaveBeenCalled();
	});
});
