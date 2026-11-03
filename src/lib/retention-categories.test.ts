import { describe, expect, it } from "vitest";
import { sourceLabel } from "./retention-categories";

describe("sourceLabel", () => {
	it("names every record source", () => {
		expect(sourceLabel("event_attendance")).toBe("Event attendance");
		expect(sourceLabel("feedback_share")).toBe("Feedback form, the other 25%");
		expect(sourceLabel("survey_response")).toBe("Points for answering");
		expect(sourceLabel("manual")).toBe("Manual record");
	});
});
