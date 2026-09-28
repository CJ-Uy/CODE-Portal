import { describe, expect, it } from "vitest";
import { createManualRetentionRecordInputSchema, eventAwardsInputSchema } from "./types";

describe("createManualRetentionRecordInputSchema", () => {
	it("requires a point type for a manual entry", () => {
		expect(() =>
			createManualRetentionRecordInputSchema.parse({
				memberIds: ["mem_a"],
				termId: "term_1",
				reason: "Submitted the required medical waiver",
			}),
		).toThrow();

		const parsed = createManualRetentionRecordInputSchema.parse({
			memberIds: ["mem_a"],
			termId: "term_1",
			pointTypeId: "pt_retention",
			reason: "Submitted the required medical waiver",
		});
		expect(parsed).toEqual({
			memberIds: ["mem_a"],
			termId: "term_1",
			pointTypeId: "pt_retention",
			eventId: null,
			points: null,
			reason: "Submitted the required medical waiver",
		});
	});

	it("allows a negative point value", () => {
		const parsed = createManualRetentionRecordInputSchema.parse({
			memberIds: ["mem_a"],
			termId: "term_1",
			pointTypeId: "pt_retention",
			points: -5,
			reason: "Logged violation",
		});
		expect(parsed.points).toBe(-5);
	});

	it("de-duplicates member ids", () => {
		const parsed = createManualRetentionRecordInputSchema.parse({
			memberIds: ["mem_a", "mem_a", "mem_b"],
			termId: "term_1",
			pointTypeId: "pt_retention",
			reason: "Attended makeup session",
		});
		expect(parsed.memberIds).toEqual(["mem_a", "mem_b"]);
	});

	it("rejects an empty member list", () => {
		expect(() =>
			createManualRetentionRecordInputSchema.parse({ memberIds: [], termId: "term_1", reason: "x" }),
		).toThrow();
	});

	it("rejects a blank reason", () => {
		expect(() =>
			createManualRetentionRecordInputSchema.parse({ memberIds: ["mem_a"], termId: "term_1", reason: "   " }),
		).toThrow();
	});

	it("rejects a non-integer point value", () => {
		expect(() =>
			createManualRetentionRecordInputSchema.parse({
				memberIds: ["mem_a"],
				termId: "term_1",
				points: 2.5,
				reason: "x",
			}),
		).toThrow();
	});
});

describe("eventAwardsInputSchema", () => {
	it("accepts a bounded typed award set", () => {
		expect(
			eventAwardsInputSchema.parse([
				{ pointTypeId: "pt_retention", points: 2 },
				{ pointTypeId: "pt_frontliner", points: -3 },
			]),
		).toHaveLength(2);
	});

	it("accepts fractional points and quantizes to 2dp", () => {
		expect(eventAwardsInputSchema.parse([{ pointTypeId: "pt_retention", points: 0.75 }])).toEqual([
			{ pointTypeId: "pt_retention", points: 0.75 },
		]);
		expect(eventAwardsInputSchema.parse([{ pointTypeId: "pt_retention", points: 2.567 }])).toEqual([
			{ pointTypeId: "pt_retention", points: 2.57 },
		]);
	});

	it("rejects out-of-range points", () => {
		expect(() => eventAwardsInputSchema.parse([{ pointTypeId: "pt_retention", points: 101 }])).toThrow();
		expect(() => eventAwardsInputSchema.parse([{ pointTypeId: "pt_retention", points: -101 }])).toThrow();
	});

	it("rejects more than 100 awards", () => {
		const awards = Array.from({ length: 101 }, (_, index) => ({
			pointTypeId: `pt_${index}`,
			points: 1,
		}));
		expect(() => eventAwardsInputSchema.parse(awards)).toThrow("at most 100");
	});
});
