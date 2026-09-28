import { expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db", () => ({ getRepositories: vi.fn() }));
vi.mock("@/server/auth/actor", () => ({ requireActor: vi.fn(async () => ({ memberId: "member-1" })) }));

import { getRepositories } from "@/db";
import { createEventAction } from "./actions";

it("returns a field error before accessing the database", async () => {
	const result = await createEventAction({
		title: "A".repeat(161),
		type: "casual",
		place: "Hall",
		description: "Study session",
		startsAt: "2026-10-01T01:00:00.000Z",
		endsAt: "2026-10-01T02:00:00.000Z",
		capacity: null,
		graceMinutes: null,
		rsvpForm: [],
		rsvpResponsesPublic: false,
		allDay: false,
		readOnly: false,
	});

	expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^title:/) });
	expect(getRepositories).not.toHaveBeenCalled();
});
