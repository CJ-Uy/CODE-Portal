import { describe, expect, it } from "vitest";
import { can, normalizeRoleKey, type Actor, type PermissionAction, type RoleKey } from "./permissions";

const cases: Array<{ role: RoleKey; allowed: PermissionAction[] }> = [
	{ role: "member", allowed: [] },
	{ role: "events", allowed: ["event:moderate", "event:points", "event:create_restricted"] },
	{ role: "link", allowed: ["link:moderate"] },
	{ role: "retention", allowed: ["points:assign", "retention:record", "retention:configure"] },
	{ role: "member_admin", allowed: ["member:manage", "role:assign", "roster:manage", "nav:configure"] },
];

const actions: PermissionAction[] = [
	"event:moderate",
	"event:points",
	"event:create_restricted",
	"points:assign",
	"retention:record",
	"retention:configure",
	"link:moderate",
	"role:assign",
	"survey:configure",
	"member:manage",
	"roster:manage",
	"nav:configure",
];

describe("permissions", () => {
	it("denies anonymous actors", () => {
		expect(actions.every((action) => !can(null, action))).toBe(true);
	});

	it("grants every permission to super admins", () => {
		const actor: Actor = { memberId: "super", roles: ["member", "super"] };
		expect(actions.every((action) => can(actor, action))).toBe(true);
	});

	it.each(cases)("maps $role to its scoped permissions", ({ role, allowed }) => {
		const actor: Actor = { memberId: role, roles: ["member", role] };
		for (const action of actions) {
			expect(can(actor, action)).toBe(allowed.includes(action));
		}
	});

	it("aliases calendar role keys to events", () => {
		expect(normalizeRoleKey("calendar")).toBe("events");
	});
});
