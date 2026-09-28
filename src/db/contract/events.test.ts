import { describe, expect, it } from "vitest";
import { eventsContract } from "./events";

describe("eventsContract point awards", () => {
	it("parses typed awards and keeps the write operation shared-dev denied", () => {
		const input = eventsContract.setAwards.input.parse({
			eventId: "evt_1",
			awards: [
				{ pointTypeId: "pt_retention", points: 2 },
				{ pointTypeId: "pt_frontliner", points: 3 },
			],
		});

		expect(input.awards).toHaveLength(2);
		expect(eventsContract.setAwards.sharedDev).toBe("deny");
	});
});
