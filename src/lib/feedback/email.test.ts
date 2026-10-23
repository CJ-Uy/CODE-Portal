import { describe, expect, it } from "vitest";
import { formatUtc8DateTime } from "@/lib/date-slots";
import { emailContentSchema } from "@/lib/email/blocks";
import { FEEDBACK_EMAIL_CATEGORY_ID, feedbackEmailContent } from "./email";

const CLOSES = new Date("2026-10-13T12:00:00Z");
const WHEN = formatUtc8DateTime(CLOSES);
const input = { title: "Hackfest", link: "https://x/portal/surveys/s1", closesAt: CLOSES, estimate: "About 6 min" };
const texts = (blocks: ReturnType<typeof feedbackEmailContent>["blocks"]) => blocks.flatMap((b) => (b.type === "text" ? [b.props.text] : []));

describe("feedbackEmailContent", () => {
	it("uses the dedicated category", () => {
		expect(FEEDBACK_EMAIL_CATEGORY_ID).toBe("ecat_feedback");
	});

	it("writes the invite with the exact subject and button", () => {
		const c = feedbackEmailContent("invite", input);
		expect(c.subject).toBe("How was Hackfest?");
		expect(c.preheader).toBe("Your feedback helps the next one go better.");
		expect(c.blocks.some((b) => b.type === "button" && b.props.href === "https://x/portal/surveys/s1")).toBe(true);
		expect(c.blocks.find((b) => b.type === "button")).toMatchObject({ props: { label: "Give feedback" } });
		expect(texts(c.blocks)).toEqual([
			"Hi {{first_name}},",
			"Thanks for coming to Hackfest. We'd like your feedback. It takes about 6 min.",
			"CRS can see your name with your answers so they can follow up. Organizers see the answers without names.",
			`Open until ${WHEN}.`,
		]);
	});

	it("leaves the time out when the form's estimate is unknown, and never hard-codes one", () => {
		const invite = feedbackEmailContent("invite", { ...input, estimate: null });
		expect(texts(invite.blocks)[1]).toBe("Thanks for coming to Hackfest. We'd like your feedback.");
		const reminder = feedbackEmailContent("reminder", { ...input, estimate: null });
		expect(texts(reminder.blocks)[1]).toBe(`If you've already answered, thank you, and you can ignore this. If not, the form closes ${WHEN}.`);
		for (const c of [invite, reminder]) expect(JSON.stringify(c)).not.toMatch(/two minutes/i);
	});

	it("never implies the reminder targets non-responders, or that it is the last day", () => {
		const c = feedbackEmailContent("reminder", input);
		expect(c.subject).toBe("Reminder: share feedback on Hackfest");
		expect(JSON.stringify(c)).not.toMatch(/last day/i);
		expect(JSON.stringify(c.blocks)).toContain("If you've already answered, thank you");
		expect(texts(c.blocks)[1]).toBe(`If you've already answered, thank you, and you can ignore this. If not, it takes about 6 min, and the form closes ${WHEN}.`);
		expect(c.blocks.some((b) => b.type === "button" && b.props.label === "Give feedback")).toBe(true);
	});

	it("produces content the email schema accepts", () => {
		for (const kind of ["invite", "reminder"] as const) {
			expect(emailContentSchema.safeParse(feedbackEmailContent(kind, input)).success).toBe(true);
		}
	});
});
