import { describe, expect, it } from "vitest";
import { classifyScan, describeScan, supportsTorch } from "./scan-feedback";

describe("classifyScan", () => {
	it("flags a QR that is not ours before any request is made", () => {
		expect(classifyScan("https://example.com")).toEqual({ kind: "invalid" });
		expect(classifyScan("code:m:not a member id")).toEqual({ kind: "invalid" });
	});

	it("recognises a member code", () => {
		expect(classifyScan("code:m:mem_abc123")).toEqual({ kind: "member", memberId: "mem_abc123" });
	});
});

describe("describeScan", () => {
	const base = {
		eventId: "evt_1",
		memberId: "mem_a",
		memberName: "Juan Dela Cruz",
		memberImage: null,
		scannedAt: new Date("2026-07-25T10:00:00.000Z"),
		scannedByName: "Maria Santos",
	};

	it("reports a fresh scan", () => {
		const result = describeScan({ ...base, alreadyPresent: false }, new Date("2026-07-25T10:00:05.000Z"));
		expect(result.state).toBe("success");
		expect(result.title).toBe("Juan Dela Cruz");
		expect(result.detail).toBe("Marked present");
	});

	it("reports who scanned a duplicate and how long ago", () => {
		const result = describeScan({ ...base, alreadyPresent: true }, new Date("2026-07-25T10:12:00.000Z"));
		expect(result.state).toBe("duplicate");
		expect(result.detail).toBe("Already scanned 12 min ago by Maria Santos");
	});

	it("omits the scanner when it is unknown", () => {
		const result = describeScan(
			{ ...base, scannedByName: null, alreadyPresent: true },
			new Date("2026-07-25T10:00:30.000Z"),
		);
		expect(result.detail).toBe("Already scanned just now");
	});
});

describe("supportsTorch", () => {
	it("is false when the browser exposes no capabilities (iOS Safari)", () => {
		expect(supportsTorch(undefined)).toBe(false);
		expect(supportsTorch({} as MediaStreamTrack)).toBe(false);
	});

	it("is true only when the track advertises torch", () => {
		const withTorch = { getCapabilities: () => ({ torch: true }) } as unknown as MediaStreamTrack;
		const without = { getCapabilities: () => ({}) } as unknown as MediaStreamTrack;
		expect(supportsTorch(withTorch)).toBe(true);
		expect(supportsTorch(without)).toBe(false);
	});
});
