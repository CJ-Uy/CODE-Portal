import { z } from "zod";
import { createManualRetentionRecordInputSchema } from "@/db/types";
import { operation } from "./common";

const retentionSourceSchema = z.enum(["event_attendance", "manual", "survey_response", "feedback_share"]);

export const retentionRecordOutputSchema = z.object({
	id: z.string(),
	memberId: z.string(),
	termId: z.string(),
	eventId: z.string().nullable(),
	pointTypeId: z.string(),
	pointTypeLabel: z.string(),
	points: z.number().nullable(),
	reason: z.string(),
	source: retentionSourceSchema,
	recordedBy: z.string(),
	recordedAt: z.coerce.date(),
});

const retentionSlotOutputSchema = z.object({
	key: z.string(),
	label: z.string(),
	startsAt: z.coerce.date(),
	countsUntil: z.coerce.date(),
	earned: z.number(),
	counted: z.number(),
	overflow: z.number(),
	pending: z.number(),
	state: z.enum(["met", "open", "missed", "upcoming"]),
});

export const retentionProgressOutputSchema = z.object({
	status: z.enum(["retained", "on_track", "not_retained"]),
	met: z.number().int(),
	required: z.number().int(),
	missed: z.number().int(),
	parts: z.array(
		z.object({
			pointTypeId: z.string(),
			label: z.string(),
			period: z.enum(["year", "semester"]),
			slots: z.array(retentionSlotOutputSchema),
		}),
	),
	nextDeadline: z.object({ at: z.coerce.date(), parts: z.array(z.string()) }).nullable(),
});

export const pendingShareOutputSchema = z.object({
	eventId: z.string(),
	eventTitle: z.string(),
	eventStartsAt: z.coerce.date(),
	surveyId: z.string(),
	surveyStatus: z.enum(["draft", "running"]),
	closesAt: z.coerce.date().nullable(),
	pointTypeId: z.string(),
	pointTypeLabel: z.string(),
	points: z.number(),
});

export const leaderboardRowOutputSchema = z.object({
	memberId: z.string(),
	fullName: z.string().nullable(),
	name: z.string().nullable(),
	totalPoints: z.number(),
});

export const myHistorySummaryOutputSchema = z.object({
	termId: z.string(),
	termName: z.string(),
	recordCount: z.number().int(),
	startsAt: z.coerce.date(),
	endsAt: z.coerce.date(),
	secondSemesterStartsAt: z.coerce.date().nullable(),
});

export const termOptionOutputSchema = z.object({
	id: z.string(),
	name: z.string(),
	isCurrent: z.boolean(),
});

export const termMasterRowOutputSchema = z.object({
	recordId: z.string(),
	memberId: z.string(),
	memberEmail: z.string(),
	memberName: z.string().nullable(),
	eventId: z.string().nullable(),
	eventTitle: z.string().nullable(),
	pointTypeId: z.string(),
	pointTypeLabel: z.string(),
	points: z.number().nullable(),
	reason: z.string(),
	source: retentionSourceSchema,
	recordedAt: z.coerce.date(),
});

export const memberHistoryRowOutputSchema = termMasterRowOutputSchema;

export const eventRosterRowOutputSchema = z.object({
	memberId: z.string(),
	memberEmail: z.string(),
	memberName: z.string().nullable(),
	rsvped: z.boolean(),
	attended: z.boolean(),
	scannedAt: z.coerce.date().nullable(),
});

export const retentionContract = {
	listForMember: operation({
		input: z.object({
			memberId: z.string().min(1),
			termId: z.string().min(1),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
		output: z.object({ records: z.array(retentionRecordOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	memberTermSummary: operation({
		input: z.object({ memberId: z.string().min(1), termId: z.string().min(1) }),
		output: z.object({ progress: retentionProgressOutputSchema.nullable() }),
		auth: "member",
		sharedDev: "allow",
	}),
	leaderboard: operation({
		input: z.object({
			termId: z.string().min(1),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
		output: z.object({ rows: z.array(leaderboardRowOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	createManual: operation({
		input: createManualRetentionRecordInputSchema,
		output: z.object({ recordIds: z.array(z.string()) }),
		auth: "admin",
		permission: "retention:record",
		sharedDev: "deny",
	}),
	myHistory: operation({
		input: z.object({ termId: z.string().min(1).optional() }),
		output: z.object({
			summary: myHistorySummaryOutputSchema.nullable(),
			records: z.array(retentionRecordOutputSchema.extend({
				eventTitle: z.string().nullable().default(null),
				eventStartsAt: z.coerce.date().nullable().default(null),
				eventType: z.string().nullable().default(null),
				eventTypeLabel: z.string().nullable().default(null),
				eventColour: z.string().nullable().default(null),
			})),
			pendingShares: z.array(pendingShareOutputSchema).default([]),
			progress: retentionProgressOutputSchema.nullable().default(null),
		}),
		auth: "member",
		sharedDev: "allow",
	}),
	myTerms: operation({
		input: z.object({}),
		output: z.object({ terms: z.array(termOptionOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	reportTerm: operation({
		input: z.object({ termId: z.string().min(1) }),
		output: z.object({ rows: z.array(termMasterRowOutputSchema) }),
		auth: "admin",
		permission: "retention:record",
		sharedDev: "allow",
	}),
	reportMember: operation({
		input: z.object({ memberId: z.string().min(1), termId: z.string().min(1) }),
		output: z.object({ rows: z.array(memberHistoryRowOutputSchema) }),
		auth: "admin",
		permission: "retention:record",
		sharedDev: "allow",
	}),
	reportEvent: operation({
		input: z.object({ eventId: z.string().min(1) }),
		output: z.object({ rows: z.array(eventRosterRowOutputSchema) }),
		auth: "admin",
		permission: "retention:record",
		sharedDev: "allow",
	}),
};
