import { describe, expect, it, vi } from "vitest";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/db", () => ({ getRepositories: async () => ({ events: { update } }) }));
vi.mock("@/server/auth/actor", () => ({ requireActor: async () => ({ memberId: "owner", roles: ["member"] }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateEventAction } from "./actions";

describe("past event details", () => {
	it.each([null, "2020-07-10T12:00:00.000Z"])("preserves the saved schedule and informational mode when editing text (end %s)", async (endsAt) => {
		const description = "Corrected details\n\nhttps://ateneocode.org";
		await updateEventAction({
			eventId: "past-event",
			title: "Past event",
			type: "casual",
			place: "Room 1",
			description,
			startsAt: "2020-07-10T10:00:00.000Z",
			endsAt,
		});
		const patch = update.mock.lastCall?.[2];
		expect(patch).toMatchObject({
			description,
			startsAt: new Date("2020-07-10T10:00:00.000Z"),
			endsAt: endsAt ? new Date(endsAt) : undefined,
		});
		expect(patch.readOnly).toBeUndefined();
	});
});
