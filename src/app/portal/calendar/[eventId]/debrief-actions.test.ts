import { beforeEach, describe, expect, it, vi } from "vitest";

const { save, revalidatePath } = vi.hoisted(() => ({ save: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/db", () => ({ getRepositories: async () => ({ eventDebriefs: { save } }) }));
vi.mock("@/server/auth/actor", () => ({ requireActor: async () => ({ memberId: "organizer", roles: ["member"] }) }));
vi.mock("@/server/features", () => ({ assertFeatureEnabled: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { saveDebriefAction } from "./debrief-actions";

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) data.set(key, value);
	return data;
}

beforeEach(() => {
	save.mockReset();
	revalidatePath.mockReset();
});

describe("saveDebriefAction", () => {
	it("saves through the repository as the signed-in member and revalidates both event pages", async () => {
		save.mockResolvedValue({});
		const result = await saveDebriefAction(form({ eventId: "evt_1", intended: " Meet people ", happened: "", why: "", change: "Start earlier" }));

		expect(result).toEqual({ saved: true });
		expect(save).toHaveBeenCalledWith(
			{ memberId: "organizer", roles: ["member"] },
			{ eventId: "evt_1", intended: "Meet people", happened: null, why: null, change: "Start earlier" },
		);
		expect(revalidatePath).toHaveBeenCalledWith("/portal/calendar/evt_1");
		expect(revalidatePath).toHaveBeenCalledWith("/portal/admin/data/events/evt_1");
	});

	it("does not touch the repository for a form that does not fit", async () => {
		const result = await saveDebriefAction(form({ eventId: "evt_1", why: "a".repeat(2001) }));

		expect(result).toEqual({ error: expect.stringContaining("2000") });
		expect(save).not.toHaveBeenCalled();
		expect(revalidatePath).not.toHaveBeenCalled();
	});

	it("shows the repository's own refusal and saves nothing", async () => {
		save.mockRejectedValue(new Error("Not authorized to save this debrief."));
		const result = await saveDebriefAction(form({ eventId: "evt_1", intended: "x" }));

		expect(result).toEqual({ error: "Not authorized to save this debrief." });
		expect(revalidatePath).not.toHaveBeenCalled();
	});

	it("replaces any other error with a generic message and logs the error type without the debrief text", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		save.mockRejectedValue(new Error("D1_ERROR: failed to write 'the secret plan'"));
		const result = await saveDebriefAction(form({ eventId: "evt_1", intended: "the secret plan" }));

		expect(result).toEqual({ error: "Couldn't save the debrief. Try again." });
		expect(JSON.stringify(log.mock.calls)).not.toContain("secret plan");
		log.mockRestore();
	});
});
