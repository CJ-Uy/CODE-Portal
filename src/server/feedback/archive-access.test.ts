import { describe, expect, it } from "vitest";
import type { Actor, RoleKey } from "@/server/auth/permissions";
import { archiveAccess } from "./archive-access";

const actor = (...roles: RoleKey[]): Actor => ({ memberId: "mem_1", roles });

describe("archiveAccess", () => {
	it("is open to the retention role and super when surveys are on", () => {
		expect(archiveAccess(actor("member", "retention"), true)).toBe(true);
		expect(archiveAccess(actor("super"), true)).toBe(true);
	});

	it("stays closed when surveys are off, even for super", () => {
		expect(archiveAccess(actor("member", "retention"), false)).toBe(false);
		expect(archiveAccess(actor("super"), false)).toBe(false);
	});

	it("is closed to roles that hold neither permission, and to a signed-out visitor", () => {
		expect(archiveAccess(actor("member"), true)).toBe(false);
		expect(archiveAccess(actor("member", "events"), true)).toBe(false);
		expect(archiveAccess(actor("member", "publishing"), true)).toBe(false);
		expect(archiveAccess(null, true)).toBe(false);
	});
});
