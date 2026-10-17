import type { InferInsertModel } from "drizzle-orm";
import {
	auditLogs,
	crsAttendance,
	crsEvents,
	eventForumPosts,
	libraryItems,
	libraryTags,
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
import { TAG_GROUPS } from "@/lib/library/taxonomy";
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
	{ id: "role_email", key: "email", label: "Email", description: "Sends member emails and manages templates, categories, and the reply inbox.", kind: "admin" },
];

export const seedPointTypes: InferInsertModel<typeof pointTypes>[] = [
	{ id: "pt_retention", key: "retention", label: "Retention", active: true, position: 0 },
	{ id: "pt_frontliner", key: "frontliner", label: "Frontliner", active: true, position: 1 },
	{ id: "pt_project_lead", key: "project_lead", label: "Project Lead", active: true, position: 2 },
];

// Synthetic content only: made-up titles and text, one item per format. Never paste real
// member work or client material into this repository.
export const seedLibraryItems: InferInsertModel<typeof libraryItems>[] = [
	{
		id: "lib_seed_page",
		kind: "guide",
		format: "page",
		source: "code",
		status: "published",
		confidentiality: "members",
		title: "Running a first workshop warm-up",
		dek: "A short, made-up guide to opening a session so people start talking.",
		readMinutes: 2,
		authorsJson: [{ name: "Demo Admin", memberId: "mem_demo_admin" }],
		blocksJson: [
			{ id: "blk_seed_p1", type: "heading", props: { text: "Why warm up", level: 2 } },
			{ id: "blk_seed_p2", type: "text", props: { text: "A good warm-up lowers the cost of the first answer. Keep it under five minutes." } },
			{
				id: "blk_seed_p3",
				type: "list",
				props: { ordered: true, items: ["Ask one easy question", "Let pairs compare answers", "Invite two volunteers to share"] },
			},
			{ id: "blk_seed_p4", type: "callout", props: { tone: "tip", text: "Reuse the same warm-up for a whole term so the group knows what to expect." } },
		],
		createdBy: "mem_demo_admin",
	},
	{
		id: "lib_seed_file",
		kind: "template",
		format: "file",
		source: "code",
		status: "published",
		confidentiality: "members",
		title: "Sample session agenda template",
		dek: "A made-up one-page agenda template with time boxes.",
		readMinutes: 1,
		authorsJson: [{ name: "Demo Admin", memberId: "mem_demo_admin" }],
		fileKey: "library/lib_seed_file/mem_demo_admin/sample-session-agenda.pdf",
		fileName: "sample-session-agenda.pdf",
		fileType: "application/pdf",
		fileBytes: 48213,
		year: 2026,
		createdBy: "mem_demo_admin",
	},
	{
		id: "lib_seed_link",
		kind: "website",
		format: "link",
		source: "outside",
		status: "published",
		confidentiality: "members",
		title: "Example youth organization handbook",
		dek: "A made-up outside website about running a student organization.",
		readMinutes: 1,
		authorsJson: [{ name: "Example Author" }],
		url: "https://example.com/youth-org-handbook",
		publicReadiness: "not_eligible",
		createdBy: "mem_demo_admin",
	},
];

/** The starting tag vocabulary: one row per name in TAG_GROUPS. The id is a readable key, the slug is the lookup key. */
export const seedLibraryTags: InferInsertModel<typeof libraryTags>[] = TAG_GROUPS.flatMap(({ group, tags }) =>
	tags.map((name) => {
		const slug = name.toLowerCase().replace(/\s+/g, " ").trim();
		return { id: `ltg_${slug.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`, name, slug, groupName: group };
	}),
);

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
	{ id: "srvq_demo_1", surveyId: "srv_demo", position: 1, type: "scale", prompt: "How useful was the session?", optionsJson: '["Strongly disagree","Strongly agree"]' },
];

export const seedSurveyAssignments: InferInsertModel<typeof surveyAssignments>[] = [
	{ surveyId: "srv_demo", memberId: "mem_demo_member" },
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
