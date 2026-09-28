import type { InferInsertModel } from "drizzle-orm";
import {
	auditLogs,
	crsAttendance,
	crsEvents,
	eventForumPosts,
	libraryItems,
	linkDailyStats,
	linkHourlyStats,
	members,
	memberRoles,
	navPins,
	pointTypes,
	quickLinks,
	reservedSlugs,
	retentionRecords,
	roles,
	seedEventTypes,
	sharedDevTokens,
	shortLinks,
	surveyAssignments,
	surveyQuestions,
	surveys,
	termMemberRoster,
	terms,
} from "@/db/schema";
import { RESERVED_SLUG_DEFAULTS } from "@/lib/links";

const now = new Date("2026-06-18T00:00:00.000Z");
const later = new Date("2026-07-10T10:00:00.000Z");

export const seedRoles: InferInsertModel<typeof roles>[] = [
	{ id: "role_super", key: "super", label: "Super admin", description: "Full portal access.", kind: "admin" },
	{ id: "role_events", key: "events", label: "Events", description: "Moderates events and attendance points.", kind: "admin" },
	{ id: "role_link", key: "link", label: "Links", description: "Moderates short links.", kind: "admin" },
	{ id: "role_retention", key: "retention", label: "Retention", description: "Logs retention records.", kind: "admin" },
	{ id: "role_member_admin", key: "member_admin", label: "Member admin", description: "Manages member profiles, roles, roster, and nav pins.", kind: "admin" },
	{ id: "role_publishing", key: "publishing", label: "Publishing", description: "Manages announcements and the content library.", kind: "admin" },
];

export const seedPointTypes: InferInsertModel<typeof pointTypes>[] = [
	{ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 0 },
	{ id: "pt_frontliner", key: "frontliner", label: "Frontliner", active: true, position: 1 },
	{ id: "pt_project_lead", key: "project_lead", label: "Project Lead", active: true, position: 2 },
];

export const seedLibraryItems: InferInsertModel<typeof libraryItems>[] = [
	{
		id: "lib_onboarding",
		kind: "article",
		confidentiality: "public",
		category: "Onboarding",
		title: "What CODE retention actually measures",
		dek: "A plain-language guide to points, retained status, and why events matter.",
		readMinutes: 6,
		abstract: "Retention is how CODE keeps track of active membership across a term.\n\nThis piece explains the moving parts without the jargon.",
		sectionsJson: [
			{ heading: "Points", body: "You earn points by attending approved events and through manual records logged by retention admins." },
			{ heading: "Retained status", body: "Crossing the term threshold marks you retained for that term." },
		],
		componentsJson: [
			{ name: "Term", definition: "A scoped period retention is measured against.", example: "AY 2026 Sem 1" },
		],
		questionsJson: ["What happens if I miss the threshold?", "Do casual events count?"],
		referencesJson: ["CODE member handbook, section 4"],
		topicsJson: ["retention", "onboarding", "points"],
		createdBy: "mem_demo_admin",
	},
	{
		id: "lib_events_playbook",
		kind: "case_study",
		confidentiality: "members",
		category: "Operations",
		title: "Running a smooth event check-in",
		dek: "How organizers cut check-in lines using QR codes.",
		readMinutes: 4,
		abstract: "A short retro on the QR check-in flow and what made queues move faster.",
		sectionsJson: [
			{ heading: "Before", body: "Paper sign-in sheets created bottlenecks at the door." },
			{ heading: "After", body: "Members show a short-lived QR; organizers scan and move on." },
		],
		componentsJson: [],
		questionsJson: ["How do we handle members without phones?"],
		referencesJson: [],
		topicsJson: ["events", "operations", "qr"],
		createdBy: "mem_demo_admin",
	},
	{
		id: "lib_internal_notes",
		kind: "article",
		confidentiality: "confidential",
		category: "Internal",
		title: "Officer transition notes",
		dek: "Confidential handover details for incoming officers.",
		readMinutes: 8,
		abstract: "Internal-only context for the officer transition. Visible to publishers and super admins.",
		sectionsJson: [{ heading: "Accounts", body: "Where shared credentials live and how access is rotated." }],
		componentsJson: [],
		questionsJson: [],
		referencesJson: [],
		topicsJson: ["internal", "officers"],
		createdBy: "mem_demo_admin",
	},
];

export const seedMembers: InferInsertModel<typeof members>[] = [
	{ id: "mem_demo_admin", email: "admin@example.com", name: "Demo Admin", fullName: "Demo Admin", batch: "2026", status: "active" },
	{ id: "mem_demo_member", email: "member@example.com", name: "Demo Member", fullName: "Demo Member", batch: "2027", status: "active" },
];

export const seedMemberRoles: InferInsertModel<typeof memberRoles>[] = [
	{ memberId: "mem_demo_admin", roleId: "role_super", assignedBy: "mem_demo_admin" },
];

export const seedTerms: InferInsertModel<typeof terms>[] = [
	{ id: "term_2026_1", name: "Term 1 2026", retainedAt: 20, probationBelow: 10, startsAt: now, endsAt: new Date("2026-10-31T00:00:00.000Z") },
];

export const seedTermMemberRoster: InferInsertModel<typeof termMemberRoster>[] = [
	{ termId: "term_2026_1", email: "admin@example.com", memberId: "mem_demo_admin", addedBy: "mem_demo_admin", addedAt: now },
	{ termId: "term_2026_1", email: "member@example.com", memberId: "mem_demo_member", addedBy: "mem_demo_admin", addedAt: now },
];

export const seedReservedSlugs: InferInsertModel<typeof reservedSlugs>[] = RESERVED_SLUG_DEFAULTS.map((slug) => ({ slug }));

export const seedShortLinks: InferInsertModel<typeof shortLinks>[] = [
	{
		id: "lnk_demo",
		slug: "welcome",
		destinationUrl: "https://example.com/code",
		title: "Welcome link",
		ownerMemberId: "mem_demo_admin",
		clickCount: 9,
		previewTitle: "Welcome to CODE",
		previewDescription: "Ateneo CODE member resources and sign-in.",
		previewImageKey: null,
	},
];

export const seedLinkDailyStats: InferInsertModel<typeof linkDailyStats>[] = [
	{ linkId: "lnk_demo", date: "2026-06-17", referrerBucket: "direct", deviceBucket: "desktop", count: 3 },
	{ linkId: "lnk_demo", date: "2026-06-18", referrerBucket: "www.facebook.com", deviceBucket: "mobile", count: 4 },
	{ linkId: "lnk_demo", date: "2026-06-18", referrerBucket: "direct", deviceBucket: "desktop", count: 2 },
];

export const seedLinkHourlyStats: InferInsertModel<typeof linkHourlyStats>[] = [
	{ linkId: "lnk_demo", hour: "2026-06-17T09:00", referrerBucket: "direct", deviceBucket: "desktop", count: 1 },
	{ linkId: "lnk_demo", hour: "2026-06-17T10:00", referrerBucket: "direct", deviceBucket: "desktop", count: 2 },
	{ linkId: "lnk_demo", hour: "2026-06-18T14:00", referrerBucket: "www.facebook.com", deviceBucket: "mobile", count: 4 },
	{ linkId: "lnk_demo", hour: "2026-06-18T18:00", referrerBucket: "direct", deviceBucket: "desktop", count: 2 },
];

export const seedEvents: InferInsertModel<typeof crsEvents>[] = [
	{
		id: "evt_demo",
		title: "Consulting Practice Night",
		type: seedEventTypes[0],
		status: "approved",
		points: 5,
		place: "SOM 111",
		startsAt: later,
		endsAt: new Date("2026-07-10T12:00:00.000Z"),
		description: "A sample CRS event for portal modules.",
		createdBy: "mem_demo_admin",
		approvedBy: "mem_demo_admin",
		approvedAt: now,
		checkinSecret: "demo-checkin-secret",
	},
];

export const seedRetentionRecords: InferInsertModel<typeof retentionRecords>[] = [
	{
		id: "ret_demo_event",
		memberId: "mem_demo_member",
		termId: "term_2026_1",
		eventId: "evt_demo",
		points: 5,
		reason: "Attended Consulting Practice Night",
		source: "event_attendance",
		recordedBy: "mem_demo_admin",
		recordedAt: later,
	},
	{
		id: "ret_demo_manual",
		memberId: "mem_demo_member",
		termId: "term_2026_1",
		eventId: null,
		points: null,
		reason: "Submitted the required medical waiver",
		source: "manual",
		recordedBy: "mem_demo_admin",
		recordedAt: now,
	},
];

export const seedAttendance: InferInsertModel<typeof crsAttendance>[] = [
	{ eventId: "evt_demo", memberId: "mem_demo_member", scannedAt: later, scannedBy: "mem_demo_admin" },
];

export const seedForumPosts: InferInsertModel<typeof eventForumPosts>[] = [
	{
		id: "post_demo_open",
		eventId: "evt_demo",
		memberId: "mem_demo_member",
		anonymous: false,
		parentId: null,
		body: "Great session, thanks!",
		createdAt: later,
	},
	{
		id: "post_demo_anon",
		eventId: "evt_demo",
		memberId: "mem_demo_member",
		anonymous: true,
		parentId: null,
		body: "Could we get more practice cases?",
		createdAt: later,
	},
];

export const seedSurveys: InferInsertModel<typeof surveys>[] = [
	{ id: "srv_demo", title: "Practice Night Feedback", status: "running", sampleSize: 1, eventId: "evt_demo", createdBy: "mem_demo_admin" },
];

export const seedSurveyQuestions: InferInsertModel<typeof surveyQuestions>[] = [
	{ id: "srvq_demo_1", surveyId: "srv_demo", position: 1, type: "scale", prompt: "How useful was the session?", optionsJson: "[1,2,3,4,5]" },
];

export const seedSurveyAssignments: InferInsertModel<typeof surveyAssignments>[] = [
	// Raw token for local walkthrough: "demo-survey-token" (open
	// /portal/surveys/srv_demo?t=demo-survey-token). Only the hash is stored.
	{ surveyId: "srv_demo", memberId: "mem_demo_member", responseTokenHash: "e9bcf50bf9ddbf8980915113b56e639d69ee87c88828c8a05e04d4c0ffbcdf2d" },
];

export const seedAuditLogs: InferInsertModel<typeof auditLogs>[] = [
	{ id: "aud_demo", actorMemberId: "mem_demo_admin", action: "seed:load", targetType: "database", targetId: "local", category: "member", detail: "Initial demo seed loaded." },
];

export const seedSharedDevTokens: InferInsertModel<typeof sharedDevTokens>[] = [
	{ tokenHash: "shared-dev-admin-token-hash", memberId: "mem_demo_admin", label: "Shared admin token" },
	{ tokenHash: "shared-dev-member-token-hash", memberId: "mem_demo_member", label: "Shared member token" },
];

export const seedNavPins: InferInsertModel<typeof navPins>[] = [
	{
		id: "nav_master",
		label: "Masterfile",
		url: "https://example.com/masterfile",
		icon: "file-spreadsheet",
		position: 1,
		createdBy: "mem_demo_admin",
	},
	{
		id: "nav_guide",
		label: "Admin guidebook",
		url: "https://example.com/guidebook",
		icon: "book-open",
		position: 2,
		createdBy: "mem_demo_admin",
	},
];

export const seedQuickLinks: InferInsertModel<typeof quickLinks>[] = [
	{
		id: "qlk_directory",
		label: "Member directory",
		url: "https://example.com/directory",
		position: 1,
		createdBy: "mem_demo_admin",
	},
	{
		id: "qlk_constitution",
		label: "Constitution",
		url: "https://example.com/constitution",
		position: 2,
		createdBy: "mem_demo_admin",
	},
	{
		id: "qlk_finance",
		label: "Finance guide",
		url: "https://example.com/finance",
		position: 3,
		createdBy: "mem_demo_admin",
	},
];
