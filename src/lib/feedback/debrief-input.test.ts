import { describe, expect, it } from "vitest";
import type { EventDebrief } from "@/db/types";
import { DEBRIEF_FIELDS, debriefView, knownDebriefError, lastEditedLine, parseDebriefForm } from "./debrief-input";

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) data.set(key, value);
	return data;
}

describe("parseDebriefForm", () => {
	it("trims each field and stores an empty one as null", () => {
		const input = parseDebriefForm(form({ eventId: "evt_1", intended: "  Meet the new members  ", happened: "", why: "   ", change: "Start earlier" }));
		expect(input).toEqual({ eventId: "evt_1", intended: "Meet the new members", happened: null, why: null, change: "Start earlier" });
	});

	it("leaves out a field the form did not post, so its saved value is kept", () => {
		const input = parseDebriefForm(form({ eventId: "evt_1", change: "Start earlier" }));
		expect(input.intended).toBeUndefined();
		expect(input.happened).toBeUndefined();
		expect(input.change).toBe("Start earlier");
	});

	it("keeps every saved value when only the event is posted, and clears a field posted empty", () => {
		expect(parseDebriefForm(form({ eventId: "evt_1" }))).toEqual({ eventId: "evt_1" });
		expect(parseDebriefForm(form({ eventId: "evt_1", why: "" }))).toEqual({ eventId: "evt_1", why: null });
	});

	it("folds the CRLF line breaks a textarea posts, so the 2000-character limit matches what the browser counted", () => {
		const twoThousand = "a\r\n".repeat(1000);
		const input = parseDebriefForm(form({ eventId: "evt_1", intended: twoThousand }));
		expect(input.intended).toBe("a\n".repeat(999) + "a");
		expect(input.intended).not.toContain("\r");
	});

	it("rejects an answer over 2000 characters", () => {
		expect(() => parseDebriefForm(form({ eventId: "evt_1", why: "a".repeat(2001) }))).toThrow();
	});

	it("rejects a form without an event", () => {
		expect(() => parseDebriefForm(form({ intended: "x" }))).toThrow();
		expect(() => parseDebriefForm(form({ eventId: "  ", intended: "x" }))).toThrow();
	});
});

describe("knownDebriefError", () => {
	it("passes through only the messages the repository wrote for people", () => {
		expect(knownDebriefError(new Error("Event not found."))).toBe("Event not found.");
		expect(knownDebriefError(new Error("Not authorized to save this debrief."))).toBe("Not authorized to save this debrief.");
	});

	it("hides anything else, such as a database error that quotes the debrief text", () => {
		expect(knownDebriefError(new Error("D1_ERROR: UNIQUE constraint failed near 'secret plans'"))).toBeNull();
		expect(knownDebriefError("Event not found.")).toBeNull();
	});
});

describe("lastEditedLine", () => {
	const at = new Date("2026-10-17T07:30:00.000Z");

	it("names the editor and the date", () => {
		const line = lastEditedLine("Ana Reyes", at);
		expect(line).toMatch(/^Last edited by Ana Reyes on Oct 17, 2026/);
	});

	it("drops the editor when their account is gone", () => {
		expect(lastEditedLine(null, at)).toMatch(/^Last edited on Oct 17, 2026/);
	});
});

describe("debriefView", () => {
	it("lists the four prompts, in order, with empty text when nothing was saved", () => {
		const view = debriefView(null);
		expect(view.fields.map((field) => field.label)).toEqual([
			"What did we set out to do?",
			"What actually happened?",
			"Why was there a difference?",
			"What will we do differently next time?",
		]);
		expect(view.fields.every((field) => field.value === "")).toBe(true);
		expect(view.lastEdited).toBeNull();
		expect(view.fields.map((field) => field.name)).toEqual(DEBRIEF_FIELDS.map((field) => field.name));
	});

	it("fills saved text and the last editor, and sends no ids", () => {
		const debrief: EventDebrief & { updatedByName: string | null } = {
			eventId: "evt_1",
			intended: "Meet people",
			happened: null,
			why: null,
			change: "Start earlier",
			updatedBy: "mem_9",
			updatedAt: new Date("2026-10-17T07:30:00.000Z"),
			updatedByName: "Ana Reyes",
		};
		const view = debriefView(debrief);
		expect(view.fields.map((field) => field.value)).toEqual(["Meet people", "", "", "Start earlier"]);
		expect(view.lastEdited).toMatch(/^Last edited by Ana Reyes on Oct 17, 2026/);
		expect(JSON.stringify(view)).not.toContain("mem_9");
	});
});
