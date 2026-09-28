import { describe, expect, it } from "vitest";
import { canUseCameraScanner } from "@/lib/camera-scanner-support";

describe("canUseCameraScanner", () => {
	it("supports browsers with camera access even without BarcodeDetector", () => {
		const nav = {
			mediaDevices: { getUserMedia: () => Promise.resolve({} as MediaStream) },
		} as unknown as Navigator;

		expect(canUseCameraScanner(nav)).toBe(true);
	});

	it("rejects browsers without camera access", () => {
		expect(canUseCameraScanner(undefined)).toBe(false);
		expect(canUseCameraScanner({ mediaDevices: {} } as unknown as Navigator)).toBe(false);
	});
});
