import { describe, expect, it } from "vitest";
import type { Actor } from "./permissions";
import { assertAdminScope, hasAnyAdminScope } from "./admin";

const memberOnly: Actor = { memberId: "m1", roles: ["member"] };
const rosterAdmin: Actor = { memberId: "m2", roles: ["member", "member_admin"] };
const retentionAdmin: Actor = { memberId: "m3", roles: ["member", "retention"] };
const linkAdmin: Actor = { memberId: "m4", roles: ["member", "link"] };
const superAdmin: Actor = { memberId: "m5", roles: ["super"] };

describe("hasAnyAdminScope", () => {
	it("denies a null actor and a base member", () => {
		expect(hasAnyAdminScope(null)).toBe(false);
		expect(hasAnyAdminScope(memberOnly)).toBe(false);
	});

	it("allows any actor holding at least one admin-capable scope", () => {
		expect(hasAnyAdminScope(rosterAdmin)).toBe(true);
		expect(hasAnyAdminScope(retentionAdmin)).toBe(true);
		expect(hasAnyAdminScope(linkAdmin)).toBe(true);
		expect(hasAnyAdminScope(superAdmin)).toBe(true);
	});
});

describe("assertAdminScope", () => {
	it("returns the actor when an admin scope is present", () => {
		expect(assertAdminScope(rosterAdmin)).toBe(rosterAdmin);
	});

	it("throws for a base member or null actor", () => {
		expect(() => assertAdminScope(memberOnly)).toThrow("Not authorized");
		expect(() => assertAdminScope(null)).toThrow("Not authorized");
	});
});
