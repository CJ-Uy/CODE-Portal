import { describe, expect, it } from "vitest";
import { can, normalizeRoleKey, type Actor } from "./permissions";

describe("email permissions", () => {
	it("grants the email role both email actions and nothing else", () => {
		const actor: Actor = { memberId: "mem_e", roles: ["email"] };
		expect(can(actor, "email:send")).toBe(true);
		expect(can(actor, "email:configure")).toBe(true);
		expect(can(actor, "announcement:manage")).toBe(false);
		expect(can(actor, "role:assign")).toBe(false);
	});

	it("lets super send and configure, and refuses plain members", () => {
		expect(can({ memberId: "mem_s", roles: ["super"] }, "email:configure")).toBe(true);
		expect(can({ memberId: "mem_m", roles: ["member"] }, "email:send")).toBe(false);
		expect(can({ memberId: "mem_p", roles: ["publishing"] }, "email:send")).toBe(false);
	});

	it("recognises email as a role key", () => {
		expect(normalizeRoleKey("email")).toBe("email");
	});
});
