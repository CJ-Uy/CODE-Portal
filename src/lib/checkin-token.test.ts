import { describe, expect, it } from "vitest";
import { createCheckinToken, isCheckinToken, verifyCheckinToken } from "./checkin-token";

const SECRET = "test-secret-value";

describe("checkin-token", () => {
	it("round-trips a valid token", async () => {
		const now = 1_000_000;
		const token = await createCheckinToken(SECRET, { memberId: "mem_abc", eventId: "evt_1" }, now);
		expect(isCheckinToken(token)).toBe(true);
		const result = await verifyCheckinToken(SECRET, token, "evt_1", now + 1000);
		expect(result).toEqual({ memberId: "mem_abc" });
	});

	it("rejects an expired token", async () => {
		const now = 1_000_000;
		const token = await createCheckinToken(SECRET, { memberId: "mem_abc", eventId: "evt_1" }, now);
		expect(await verifyCheckinToken(SECRET, token, "evt_1", now + 6 * 60 * 1000)).toBeNull();
	});

	it("rejects a token for a different event", async () => {
		const token = await createCheckinToken(SECRET, { memberId: "mem_abc", eventId: "evt_1" });
		expect(await verifyCheckinToken(SECRET, token, "evt_2")).toBeNull();
	});

	it("rejects a tampered signature", async () => {
		const token = await createCheckinToken(SECRET, { memberId: "mem_abc", eventId: "evt_1" });
		const tampered = `${token.slice(0, -2)}xy`;
		expect(await verifyCheckinToken(SECRET, tampered, "evt_1")).toBeNull();
	});

	it("rejects a token signed with a different secret", async () => {
		const token = await createCheckinToken(SECRET, { memberId: "mem_abc", eventId: "evt_1" });
		expect(await verifyCheckinToken("other-secret", token, "evt_1")).toBeNull();
	});
});
