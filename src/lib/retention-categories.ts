import type { RetentionRecordSource } from "@/db/schema";

/** How a record's source reads next to it. */
export function sourceLabel(source: RetentionRecordSource): string {
	switch (source) {
		case "manual":
			return "Manual record";
		case "feedback_share":
			return "Feedback form, the other 25%";
		case "survey_response":
			return "Points for answering";
		default:
			return "Event attendance";
	}
}
