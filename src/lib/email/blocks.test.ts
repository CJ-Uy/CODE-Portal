import { describe, expect, it } from "vitest";
import { audienceSchema, blocksSchema, emailContentSchema, newBlock, newHtmlBlock } from "./blocks";

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

	it("rejects malformed merge tags inside text but allows sheet variables", () => {
		const text = { id: "t1", type: "text", props: { text: "Hi {{first-name}}" } };
		const result = blocksSchema.safeParse([text]);
		expect(result.success).toBe(false);
		expect(JSON.stringify(result.error?.issues)).toContain("first-name");
		expect(blocksSchema.safeParse([{ ...text, props: { text: "Hi {{points}}" } }]).success).toBe(true);
	});

	it("accepts one HTML body and refuses HTML mixed with blocks", () => {
		const html = newHtmlBlock("<p>Hi {{message}}</p>");
		expect(blocksSchema.safeParse([html]).success).toBe(true);
		expect(blocksSchema.safeParse([html, newBlock("divider")]).success).toBe(false);
		expect(blocksSchema.safeParse([newHtmlBlock("<p>{{Bad Tag}}</p>")]).success).toBe(false);
	});

	it("rejects near-miss merge tags", () => {
		const text = { id: "t1", type: "text", props: { text: "Hi {{First_Name}}" } };
		expect(blocksSchema.safeParse([text]).success).toBe(false);
	});

	it("rejects more than 60 blocks", () => {
		expect(blocksSchema.safeParse(Array.from({ length: 61 }, () => newBlock("divider"))).success).toBe(false);
	});
});

describe("emailContentSchema", () => {
	it("rejects malformed tags in the subject", () => {
		expect(emailContentSchema.safeParse({ subject: "Hi {{No Pe}}", preheader: "", blocks: [] }).success).toBe(false);
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
	it("accepts typed addresses, lowercased, and rejects bad or too many", () => {
		const audience = (emails: string[]) => audienceSchema.safeParse({ match: "any", include: [{ kind: "emails", emails }], exclude: [] });
		const ok = audience([" Guest@Example.com ", "mem_a@example.com"]);
		expect(ok.success).toBe(true);
		expect(ok.data?.include[0]).toEqual({ kind: "emails", emails: ["guest@example.com", "mem_a@example.com"] });
		expect(audience(["guest@example.com", "not-an-email"]).success).toBe(false);
		expect(audience([]).success).toBe(false);
		expect(audience(Array.from({ length: 1001 }, (_, i) => `p${i}@example.com`)).success).toBe(false);
	});
});
