import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/permissions";

const retentionAdmin: Actor = { memberId: "mem_admin", roles: ["member", "retention"] };
const plainMember: Actor = { memberId: "mem_plain", roles: ["member"] };

const listForTerm = vi.fn();
const listMemberTermHistory = vi.fn();
const listForEvent = vi.fn();
const getActor = vi.fn();

vi.mock("@/server/auth/actor", () => ({ getActor: () => getActor() }));
vi.mock("@/server/env", () => ({ getAppConfig: () => ({ APP_ENV: "production", APP_BASE_URL: "https://app.test" }) }));
vi.mock("@/db", () => ({
	getRepositories: async () => ({ retention: { listForTerm, listMemberTermHistory, listForEvent } }),
}));

import { GET } from "./route";

describe("GET /api/reporting/export", () => {
	beforeEach(() => {
		listForTerm.mockReset().mockResolvedValue([]);
		listMemberTermHistory.mockReset().mockResolvedValue([]);
		listForEvent.mockReset().mockResolvedValue([]);
		getActor.mockReset().mockResolvedValue(retentionAdmin);
	});

	it("returns 403 for an actor without the retention scope", async () => {
		getActor.mockResolvedValue(plainMember);
		const response = await GET(new Request("https://app.test/api/reporting/export?kind=term&termId=t1"));
		expect(response.status).toBe(403);
	});

	it("returns 401 when there is no actor", async () => {
		getActor.mockResolvedValue(null);
		const response = await GET(new Request("https://app.test/api/reporting/export?kind=term&termId=t1"));
		expect(response.status).toBe(401);
	});

	it("returns 400 for an unknown kind or missing params", async () => {
		const bad = await GET(new Request("https://app.test/api/reporting/export?kind=bogus"));
		expect(bad.status).toBe(400);
		const missing = await GET(new Request("https://app.test/api/reporting/export?kind=member&termId=t1"));
		expect(missing.status).toBe(400);
	});

	it("streams a term master workbook with attachment headers", async () => {
		const response = await GET(new Request("https://app.test/api/reporting/export?kind=term&termId=t1"));
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
		expect(response.headers.get("content-disposition")).toContain("attachment");
		expect(listForTerm).toHaveBeenCalledWith(retentionAdmin, "t1");
		const body = new Uint8Array(await response.arrayBuffer());
		expect(body.byteLength).toBeGreaterThan(0);
	});
});
