import { describe, expect, it } from "vitest";
import { audienceSchema, blocksSchema, emailContentSchema, newBlock } from "./blocks";

describe("blocksSchema", () => {
	it("accepts every new block type", () => {
		const blocks = (["heading", "text", "button", "image", "divider", "spacer"] as const).map((type) => newBlock(type));
		expect(blocksSchema.safeParse(blocks).success).toBe(true);
	});

	it("rejects http and javascript links", () => {
		const button = { id: "b1", type: "button", props: { label: "Go", href: "javascript:alert(1)" } };
		const image = { id: "i1", type: "image", props: { src: "http://x.com/a.png", alt: "" } };
		expect(blocksSchema.safeParse([button]).success).toBe(false);
		expect(blocksSchema.safeParse([image]).success).toBe(false);
	});

	it("rejects unknown merge tags inside text", () => {
		const text = { id: "t1", type: "text", props: { text: "Hi {{points}}" } };
		const result = blocksSchema.safeParse([text]);
		expect(result.success).toBe(false);
		expect(JSON.stringify(result.error?.issues)).toContain("points");
	});

	it("rejects more than 60 blocks", () => {
		expect(blocksSchema.safeParse(Array.from({ length: 61 }, () => newBlock("divider"))).success).toBe(false);
	});
});

describe("emailContentSchema", () => {
	it("rejects unknown tags in the subject", () => {
		expect(emailContentSchema.safeParse({ subject: "Hi {{nope}}", preheader: "", blocks: [] }).success).toBe(false);
	});
});

describe("audienceSchema", () => {
	it("accepts mixed rules", () => {
		const audience = {
			match: "all",
			include: [{ kind: "roster", termId: "current" }, { kind: "member", memberId: "mem_1" }],
			exclude: [{ kind: "event", eventId: "evt_1", relation: "attended" }],
		};
		expect(audienceSchema.safeParse(audience).success).toBe(true);
	});
	it("rejects unknown rule kinds", () => {
		expect(audienceSchema.safeParse({ match: "any", include: [{ kind: "everyone" }], exclude: [] }).success).toBe(false);
	});
});
