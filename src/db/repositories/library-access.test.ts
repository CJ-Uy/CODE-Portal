import { describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { canEditItem, canSeeItem } from "./library-access";
import type { ItemGate } from "./library-access";

const member: Actor = { memberId: "m1", roles: ["member"] };
const owner: Actor = { memberId: "o1", roles: ["member"] };
const moderator: Actor = { memberId: "p1", roles: ["publishing"] };
const moderateOnly = { memberId: "p2", roles: [] } as Actor; // no role grants anything
const superAdmin: Actor = { memberId: "s1", roles: ["super"] };

const gate = (overrides: Partial<ItemGate> = {}): ItemGate => ({ status: "published", confidentiality: "members", createdBy: "o1", ...overrides });

describe("canSeeItem", () => {
	it("shows published items to everyone", () => {
		for (const actor of [member, owner, moderator, moderateOnly, superAdmin]) expect(canSeeItem(actor, gate())).toBe(true);
	});

	it("shows unpublished items only to the owner and moderators", () => {
		for (const status of ["draft", "pending_review", "taken_down"] as const) {
			expect(canSeeItem(member, gate({ status }))).toBe(false);
			expect(canSeeItem(owner, gate({ status }))).toBe(true);
			expect(canSeeItem(moderator, gate({ status }))).toBe(true);
			expect(canSeeItem(superAdmin, gate({ status }))).toBe(true);
		}
	});

	it("shows confidential items only to library:manage holders and the owner", () => {
		const confidential = gate({ confidentiality: "confidential" });
		expect(canSeeItem(member, confidential)).toBe(false);
		expect(canSeeItem(owner, confidential)).toBe(true);
		expect(canSeeItem(moderator, confidential)).toBe(true);
		expect(canSeeItem(superAdmin, confidential)).toBe(true);
	});

	it("an item with no owner belongs to nobody", () => {
		expect(canSeeItem(member, gate({ status: "draft", createdBy: null }))).toBe(false);
		expect(canSeeItem({ memberId: "", roles: [] }, gate({ status: "draft", createdBy: null }))).toBe(false);
	});
});

describe("canEditItem", () => {
	it("is for the owner and moderators who can see the item", () => {
		expect(canEditItem(owner, gate())).toBe(true);
		expect(canEditItem(moderator, gate())).toBe(true);
		expect(canEditItem(member, gate())).toBe(false);
		expect(canEditItem(member, gate({ createdBy: null }))).toBe(false);
	});

	it("a moderator still cannot edit what they cannot see", () => {
		const confidential = gate({ confidentiality: "confidential" });
		expect(canEditItem(moderator, confidential)).toBe(true);
		expect(canEditItem(member, confidential)).toBe(false);
	});
});
