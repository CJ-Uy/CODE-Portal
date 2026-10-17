import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/portal/calendar/[eventId]/debrief-actions", () => ({ saveDebriefAction: vi.fn() }));

import { keepChangedFields } from "./debrief-form";

const loaded = [
	{ name: "intended", label: "What did we set out to do?", value: "Meet the new members" },
	{ name: "happened", label: "What actually happened?", value: "" },
	{ name: "why", label: "Why was there a difference?", value: "Rain" },
	{ name: "change", label: "What will we do differently next time?", value: "Line one\nLine two" },
] as const;

function posted(entries: Record<string, string>) {
	const data = new FormData();
	data.set("eventId", "evt_1");
	for (const [key, value] of Object.entries(entries)) data.set(key, value);
	return keepChangedFields(data, [...loaded]);
}

describe("keepChangedFields", () => {
	it("posts only the fields edited since the form loaded, so a stale tab keeps other organizers' text", () => {
		const data = posted({ intended: "Meet the new members", happened: "Fewer came", why: "Rain", change: "Line one\r\nLine two" });
		expect([...data.keys()]).toEqual(["eventId", "happened"]);
		expect(data.get("happened")).toBe("Fewer came");
	});

	it("still posts a field emptied on purpose, as an empty string, so it clears", () => {
		const data = posted({ intended: "Meet the new members", happened: "", why: "  ", change: "Line one\nLine two" });
		expect([...data.keys()]).toEqual(["eventId", "why"]);
		expect(data.get("why")).toBe("  ");
	});

	it("posts nothing but the event when nothing changed", () => {
		const data = posted({ intended: " Meet the new members ", happened: "", why: "Rain", change: "Line one\nLine two" });
		expect([...data.keys()]).toEqual(["eventId"]);
	});
});
