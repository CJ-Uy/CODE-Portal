import { describe, expect, it } from "vitest";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

const secret = "test-unsubscribe-secret-0123456789";

describe("unsubscribe token", () => {
	it("round-trips member and category", async () => {
		const token = await signUnsubscribeToken(secret, "mem_abc", "ecat_xyz");
		expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
		expect(await verifyUnsubscribeToken(secret, token)).toEqual({ memberId: "mem_abc", categoryId: "ecat_xyz" });
	});

	it("rejects a tampered payload", async () => {
		const token = await signUnsubscribeToken(secret, "mem_abc", "ecat_xyz");
		const [, sig] = token.split(".");
		const forged = `${btoa("mem_other:ecat_xyz").replaceAll("=", "")}.${sig}`;
		expect(await verifyUnsubscribeToken(secret, forged)).toBeNull();
	});

	it("rejects a different secret and garbage", async () => {
		const token = await signUnsubscribeToken(secret, "mem_abc", "ecat_xyz");
		expect(await verifyUnsubscribeToken("another-secret-0123456789", token)).toBeNull();
		expect(await verifyUnsubscribeToken(secret, "not-a-token")).toBeNull();
		expect(await verifyUnsubscribeToken(secret, "")).toBeNull();
	});
});
