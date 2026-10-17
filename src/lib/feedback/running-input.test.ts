import { describe, expect, it } from "vitest";
import { parseRunningForm } from "./running-input";
import { errorLabel } from "./safe-log";

const form = (fields: Record<string, string>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
};

describe("parseRunningForm", () => {
	it("moves the closing time and nothing else", () => {
		const { intent, input } = parseRunningForm(form({ surveyId: "srv_1", intent: "closesAt", closesAt: "2026-10-20T16:00", close: "1" }));
		expect(intent).toBe("closesAt");
		expect(input).toEqual({ surveyId: "srv_1", closesAt: new Date("2026-10-20T08:00:00.000Z") });
	});

	it("refuses a closing time that is not a real calendar time", () => {
		expect(() => parseRunningForm(form({ surveyId: "srv_1", intent: "closesAt", closesAt: "2026-02-31T10:00" }))).toThrow("Pick a closing time.");
		expect(() => parseRunningForm(form({ surveyId: "srv_1", intent: "closesAt" }))).toThrow("Pick a closing time.");
	});

	it("closes or reminds only when that intent is named", () => {
		expect(parseRunningForm(form({ surveyId: "srv_1", intent: "close" })).input).toEqual({ surveyId: "srv_1", close: true });
		expect(parseRunningForm(form({ surveyId: "srv_1", intent: "remind", closesAt: "2026-10-20T16:00" })).input).toEqual({
			surveyId: "srv_1",
			remindNow: true,
		});
	});

	it("turns sharing on only for an explicit 1", () => {
		expect(parseRunningForm(form({ surveyId: "srv_1", intent: "share", shareWithOrganizers: "1" })).input.shareWithOrganizers).toBe(true);
		expect(parseRunningForm(form({ surveyId: "srv_1", intent: "share", shareWithOrganizers: "0" })).input.shareWithOrganizers).toBe(false);
		expect(parseRunningForm(form({ surveyId: "srv_1", intent: "share" })).input.shareWithOrganizers).toBe(false);
	});

	it("rejects a missing survey or an unknown intent", () => {
		expect(() => parseRunningForm(form({ intent: "close" }))).toThrow();
		expect(() => parseRunningForm(form({ surveyId: "srv_1", intent: "delete" }))).toThrow("Unknown change.");
		expect(() => parseRunningForm(form({ surveyId: "srv_1" }))).toThrow("Unknown change.");
	});
});

describe("errorLabel", () => {
	it("logs the error type, never its text", () => {
		expect(errorLabel(new SyntaxError('Unexpected token, "Fix the sound system" is not valid JSON'))).toBe("SyntaxError");
		expect(errorLabel("a comment about Miguel")).toBe("string");
	});
});
