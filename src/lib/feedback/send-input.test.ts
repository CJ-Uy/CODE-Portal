import { describe, expect, it } from "vitest";
import { parseSendForm, sendDefaultClosesAt } from "./send-input";

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) data.set(key, value);
	return data;
}

const BASE = { surveyId: "srv_1", closesAt: "2026-10-20T18:30" };

describe("parseSendForm", () => {
	it("defaults to the suggested sample", () => {
		const input = parseSendForm(form(BASE));
		expect(input.invite).toEqual({ mode: "suggested" });
		expect(input.surveyId).toBe("srv_1");
	});

	it("reads the invite radio", () => {
		expect(parseSendForm(form({ ...BASE, invite: "all" })).invite).toEqual({ mode: "all" });
		expect(parseSendForm(form({ ...BASE, invite: "suggested", count: "9" })).invite).toEqual({ mode: "suggested" });
	});

	it("parses a custom count", () => {
		expect(parseSendForm(form({ ...BASE, invite: "count", count: "25" })).invite).toEqual({ mode: "count", count: 25 });
	});

	it.each([
		["a missing count", {}],
		["a zero count", { count: "0" }],
		["a fractional count", { count: "2.5" }],
		["a text count", { count: "many" }],
	])("rejects %s", (_name, extra) => {
		expect(() => parseSendForm(form({ ...BASE, invite: "count", ...extra }))).toThrow();
	});

	it("rejects an unknown invite mode", () => {
		expect(() => parseSendForm(form({ ...BASE, invite: "everybody" }))).toThrow();
	});

	it("treats an absent checkbox as false and a checked one as true", () => {
		const off = parseSendForm(form(BASE));
		expect(off).toMatchObject({ allowWalkIn: false, shareWithOrganizers: false, emailInvitees: false, remind: false });

		const on = parseSendForm(form({ ...BASE, allowWalkIn: "on", shareWithOrganizers: "on", emailInvitees: "on", remind: "on" }));
		expect(on).toMatchObject({ allowWalkIn: true, shareWithOrganizers: true, emailInvitees: true, remind: true });
	});

	it("reads closesAt as UTC+8 wall-clock time", () => {
		expect(parseSendForm(form(BASE)).closesAt.toISOString()).toBe("2026-10-20T10:30:00.000Z");
	});

	it.each([["a missing value", ""], ["garbage", "tomorrow"], ["a date without a time", "2026-10-20"]])("throws on %s for closesAt", (_name, closesAt) => {
		expect(() => parseSendForm(form({ ...BASE, closesAt }))).toThrow();
	});

	it("reads points for answering, with a blank box as 0", () => {
		expect(parseSendForm(form({ ...BASE, pointsAward: "1.5", pointTypeId: "pt_feedback" }))).toMatchObject({ pointsAward: 1.5, pointTypeId: "pt_feedback" });
		expect(parseSendForm(form({ ...BASE, pointsAward: "", pointTypeId: "pt_feedback" }))).toMatchObject({ pointsAward: 0 });
		expect(parseSendForm(form({ ...BASE, pointsAward: "0", pointTypeId: "" }))).toMatchObject({ pointsAward: 0, pointTypeId: null });
		expect(parseSendForm(form({ ...BASE, pointsAward: "0.125", pointTypeId: "pt_feedback" })).pointsAward).toBe(0.13);
	});

	it.each([
		["negative points", { pointsAward: "-1", pointTypeId: "pt_feedback" }],
		["more than 100 points", { pointsAward: "101", pointTypeId: "pt_feedback" }],
		["text points", { pointsAward: "lots", pointTypeId: "pt_feedback" }],
		["points without a point type", { pointsAward: "1", pointTypeId: "" }],
	])("rejects %s", (_name, extra) => {
		expect(() => parseSendForm(form({ ...BASE, ...extra }))).toThrow();
	});

	it("throws when the survey id is missing", () => {
		expect(() => parseSendForm(form({ closesAt: BASE.closesAt }))).toThrow();
	});
});

describe("sendDefaultClosesAt", () => {
	const now = new Date("2026-10-17T00:00:00Z");

	it("is the event end plus 72 hours", () => {
		const event = { startsAt: new Date("2026-10-16T01:00:00Z"), endsAt: new Date("2026-10-16T05:00:00Z") };
		expect(sendDefaultClosesAt(event, now).toISOString()).toBe("2026-10-19T05:00:00.000Z");
	});

	it("falls back to 72 hours from now once the event window has passed", () => {
		const event = { startsAt: new Date("2026-09-01T01:00:00Z"), endsAt: new Date("2026-09-01T05:00:00Z") };
		expect(sendDefaultClosesAt(event, now).toISOString()).toBe("2026-10-20T00:00:00.000Z");
	});

	it("is 72 hours from now for a form with no event", () => {
		expect(sendDefaultClosesAt(null, now).toISOString()).toBe("2026-10-20T00:00:00.000Z");
	});
});
