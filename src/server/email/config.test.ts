import { describe, expect, it } from "vitest";
import { emailConfigFrom, isSendingAddress, plusAddress, plusTag } from "./config";

const base = {
	EMAIL_INBOX_ADDRESS: "Beta-Inbox@ateneocode.org",
	EMAIL_PUBLIC_BASE_URL: "https://beta.ateneocode.org/",
	EMAIL_UNSUBSCRIBE_SECRET: "0123456789abcdef0123",
};

describe("emailConfigFrom", () => {
	it("normalises the inbox and base URL and applies defaults", () => {
		expect(emailConfigFrom(base)).toEqual({
			inboxAddress: "beta-inbox@ateneocode.org",
			publicBaseUrl: "https://beta.ateneocode.org",
			unsubscribeSecret: "0123456789abcdef0123",
			batchPerTick: 25,
			dailyCap: 300,
		});
	});

	it("reads numeric overrides from strings", () => {
		const config = emailConfigFrom({ ...base, EMAIL_BATCH_PER_TICK: "10", EMAIL_DAILY_CAP: "50" });
		expect(config.batchPerTick).toBe(10);
		expect(config.dailyCap).toBe(50);
	});

	it("refuses a short secret", () => {
		expect(() => emailConfigFrom({ ...base, EMAIL_UNSUBSCRIBE_SECRET: "short" })).toThrow();
	});
});

describe("plus addressing", () => {
	it("adds and reads a tag", () => {
		const address = plusAddress("beta-inbox@ateneocode.org", "edl_abc123");
		expect(address).toBe("beta-inbox+edl_abc123@ateneocode.org");
		expect(plusTag(address)).toBe("edl_abc123");
		expect(plusTag("Beta-Inbox+EDL_ABC@ateneocode.org")).toBe("edl_abc");
	});

	it("returns null without a tag", () => {
		expect(plusTag("beta-inbox@ateneocode.org")).toBeNull();
	});
});

describe("isSendingAddress", () => {
	it("accepts only the CODE domain", () => {
		expect(isSendingAddress("events@ateneocode.org")).toBe(true);
		expect(isSendingAddress("events@ateneocode.org.evil.com")).toBe(false);
		expect(isSendingAddress("someone@gmail.com")).toBe(false);
	});
});
