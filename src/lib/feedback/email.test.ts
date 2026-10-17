import { describe, expect, it } from "vitest";
import { formatUtc8DateTime } from "@/lib/date-slots";
import { emailContentSchema } from "@/lib/email/blocks";
import { FEEDBACK_EMAIL_CATEGORY_ID, feedbackEmailContent } from "./email";

const CLOSES = new Date("2026-10-13T12:00:00Z");
const WHEN = formatUtc8DateTime(CLOSES);
const input = { title: "Hackfest", link: "https://x/portal/surveys/s1", closesAt: CLOSES };
const texts = (blocks: ReturnType<typeof feedbackEmailContent>["blocks"]) => blocks.flatMap((b) => (b.type === "text" ? [b.props.text] : []));

describe("feedbackEmailContent", () => {
	it("uses the dedicated category", () => {
		expect(FEEDBACK_EMAIL_CATEGORY_ID).toBe("ecat_feedback");
	});

	it("writes the invite with the exact subject and button", () => {
		const c = feedbackEmailContent("invite", input);
		expect(c.subject).toBe("How was Hackfest?");
		expect(c.preheader).toBe("Two minutes of feedback helps the next one go better.");
		expect(c.blocks.some((b) => b.type === "button" && b.props.href === "https://x/portal/surveys/s1")).toBe(true);
		expect(c.blocks.find((b) => b.type === "button")).toMatchObject({ props: { label: "Share feedback" } });
		expect(texts(c.blocks)).toEqual([
			"Hi {{first_name}},",
			"Thanks for coming to Hackfest. We'd like your feedback. It takes about two minutes, and your name isn't attached to your answers.",
			`Open until ${WHEN}.`,
		]);
	});

	it("never implies the reminder targets non-responders", () => {
		const c = feedbackEmailContent("reminder", input);
		expect(c.subject).toBe("Last day to share feedback on Hackfest");
		expect(JSON.stringify(c.blocks)).toContain("If you've already answered, thank you");
		expect(texts(c.blocks)[1]).toBe(`If you've already answered, thank you, and you can ignore this. If not, the form closes ${WHEN}.`);
		expect(c.blocks.some((b) => b.type === "button" && b.props.label === "Share feedback")).toBe(true);
	});

	it("produces content the email schema accepts", () => {
		for (const kind of ["invite", "reminder"] as const) {
			expect(emailContentSchema.safeParse(feedbackEmailContent(kind, input)).success).toBe(true);
		}
	});
});
