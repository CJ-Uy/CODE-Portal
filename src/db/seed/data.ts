import type { InferInsertModel } from "drizzle-orm";
import {
	auditLogs,
	crsAttendance,
	crsEvents,
	eventDebriefs,
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
	surveyAnswers,
	surveyAssignments,
	surveyQuestions,
	surveyResponses,
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
	{ id: "term_2026_1", name: "Term 1 2026", startsAt: now, endsAt: new Date("2027-05-15T00:00:00.000Z") },
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

// ---------------------------------------------------------------------------------------------------------------------
// Feedback demo: one past event with a sent Standard event feedback form, 8 responses, 1 hidden comment and a debrief.
// For the local results view only. These arrays are deliberately NOT part of seedEvents/seedSurveys/seedMembers, because
// scripts/export-seed-sql.ts turns those into the shared dev D1 seed and this demo must never reach it.
// ---------------------------------------------------------------------------------------------------------------------

const DEMO_EVENT_ID = "evt_demo_past";
const DEMO_SURVEY_ID = "srv_demo_past";
const INVITED_COUNT = 24;
// Three, not fewer: with 1 or 2 the invited-only filter would single them out, so the page hides it (see canFilterInvited).
const WALK_IN_COUNT = 3;

const attendeeNumber = (n: number) => String(n).padStart(2, "0");
const attendeeId = (n: number) => `mem_fb_${attendeeNumber(n)}`;

// Real response and answer ids are random. Seed ids have to repeat from run to run (the seed skips rows that exist), so
// they are a hash of a key instead: opaque, and in no order that follows who answered first.
function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}
const opaqueId = (prefix: string, key: string) => `${prefix}_${fnv1a(key)}${fnv1a(`${key}#`)}`;

const DEMO_SENT_AT = new Date("2026-09-26T12:00:00.000Z");
// Far enough out that the form stays open while you try extending, reminding and closing it.
const DEMO_CLOSES_AT = new Date("2027-01-31T08:00:00.000Z");
// A response is stamped with the start of its Manila day, never the time, so it can't be matched to an assignment.
const MANILA_SEP_27 = new Date("2026-09-26T16:00:00.000Z");
const MANILA_SEP_28 = new Date("2026-09-27T16:00:00.000Z");

export const seedFeedbackDemoMembers: InferInsertModel<typeof members>[] = Array.from(
	{ length: INVITED_COUNT + WALK_IN_COUNT },
	(_, index) => {
		const number = attendeeNumber(index + 1);
		return {
			id: attendeeId(index + 1),
			email: `attendee${number}@example.com`,
			name: `Demo Attendee ${number}`,
			fullName: `Demo Attendee ${number}`,
			batch: "2027",
			status: "active" as const,
		};
	},
);

export const seedFeedbackDemoEvents: InferInsertModel<typeof crsEvents>[] = [
	{
		id: DEMO_EVENT_ID,
		title: "Case Workshop: Market Entry",
		type: seedEventTypes[0],
		status: "approved",
		points: 5,
		place: "SOM 211",
		startsAt: new Date("2026-09-26T07:00:00.000Z"),
		endsAt: new Date("2026-09-26T10:00:00.000Z"),
		description: "A hands-on case workshop. Demo event for the feedback results view.",
		createdBy: "mem_demo_admin",
		approvedBy: "mem_demo_admin",
		approvedAt: new Date("2026-09-10T00:00:00.000Z"),
		checkinSecret: "demo-past-checkin-secret",
	},
];

// The same seven questions as the stpl_standard template in migration 0012.
const DEMO_QUESTIONS: Array<Omit<InferInsertModel<typeof surveyQuestions>, "id" | "surveyId" | "position">> = [
	{ type: "scale", prompt: "Overall, how satisfied were you with this event?", required: true, metricKey: "overall", optionsJson: '["Very dissatisfied","Very satisfied"]' },
	{
		type: "scale",
		prompt: "Event flow: timing and order of activities.",
		help: "Was the time enough? Did the order make sense?",
		required: true,
		metricKey: "flow",
		optionsJson: '["Very dissatisfied","Very satisfied"]',
	},
	{
		type: "scale",
		prompt: "Content: talks, activities, discussions.",
		help: "Was it relevant and worth your time?",
		required: true,
		metricKey: "content",
		optionsJson: '["Very dissatisfied","Very satisfied"]',
	},
	{
		type: "scale",
		prompt: "Venue: space and equipment.",
		help: "Was the space enough? Did the equipment work?",
		required: true,
		metricKey: "venue",
		optionsJson: '["Very dissatisfied","Very satisfied"]',
	},
	{
		type: "scale",
		prompt: "How likely are you to attend a similar CODE event?",
		required: true,
		metricKey: "return_intent",
		optionsJson: '["Not at all likely","Very likely"]',
	},
	{ type: "text", prompt: "What was the most valuable part of the event?", required: false },
	{ type: "text", prompt: "What is one thing we should change next time?", required: false },
];

export const seedFeedbackDemoSurveys: InferInsertModel<typeof surveys>[] = [
	{
		id: DEMO_SURVEY_ID,
		eventId: DEMO_EVENT_ID,
		title: "Feedback: Case Workshop: Market Entry",
		status: "running",
		templateId: "stpl_standard",
		sampleSize: INVITED_COUNT,
		createdBy: "mem_demo_admin",
		createdAt: new Date("2026-09-26T11:00:00.000Z"),
		sentAt: DEMO_SENT_AT,
		closesAt: DEMO_CLOSES_AT,
		reminderAt: new Date(DEMO_CLOSES_AT.getTime() - 24 * 3_600_000),
		allowWalkIn: true,
		shareWithOrganizers: true,
		emailInvitees: false,
	},
];

export const seedFeedbackDemoQuestions: InferInsertModel<typeof surveyQuestions>[] = DEMO_QUESTIONS.map((question, index) => ({
	...question,
	id: `srvq_demo_past_${index + 1}`,
	surveyId: DEMO_SURVEY_ID,
	position: index + 1,
}));

type DemoResponse = {
	source: "invited" | "walk_in";
	day: Date;
	/** overall, flow, content, venue, return intent */
	ratings: [number, number, number, number, number];
	valuable?: string;
	change?: string;
	/** The `change` comment is hidden from organizers. */
	hideChange?: boolean;
};

// Spread on purpose: overall runs 2 to 5 and venue runs 1 to 4, so the bars are not one colour. A few comments are Taglish.
const DEMO_RESPONSES: DemoResponse[] = [
	{
		source: "invited",
		day: MANILA_SEP_27,
		ratings: [5, 4, 5, 4, 5],
		valuable: "Yung case discussion, sobrang helpful ng feedback ng mga officers.",
		change: "Mas mahabang oras para sa Q&A sana.",
	},
	{
		source: "invited",
		day: MANILA_SEP_27,
		ratings: [5, 5, 5, 3, 5],
		valuable: "Learning the framework step by step. Very practical.",
		change: "The room was cold and the mic kept cutting out.",
	},
	{
		source: "invited",
		day: MANILA_SEP_27,
		ratings: [4, 3, 4, 2, 4],
		valuable: "Yung mock case. Natuto ako mag-structure ng answer.",
		change: "Start on time. We waited almost 30 minutes before the first talk.",
	},
	{ source: "invited", day: MANILA_SEP_27, ratings: [4, 4, 5, 3, 4], valuable: "Networking with the officers during the break." },
	{
		source: "invited",
		day: MANILA_SEP_28,
		ratings: [4, 2, 3, 2, 3],
		valuable: "The panel discussion was good pero medyo mahaba.",
		change: "The venue is too small, di kami lahat kasya. Please book a bigger room.",
	},
	{
		source: "walk_in",
		day: MANILA_SEP_28,
		ratings: [3, 3, 3, 2, 3],
		valuable: "The snacks, honestly.",
		change: "Sana may handouts. Hirap sundan yung slides sa likod.",
	},
	{
		source: "walk_in",
		day: MANILA_SEP_27,
		ratings: [5, 5, 4, 4, 5],
		valuable: "Hands-on case practice.",
		change: "More cases from different industries.",
	},
	{
		source: "walk_in",
		day: MANILA_SEP_28,
		ratings: [2, 2, 3, 1, 2],
		valuable: "Hard to say, di ko masyadong narinig yung speaker.",
		change: "The emcee kept putting people on the spot and made some of us uncomfortable.",
		hideChange: true,
	},
];

export const seedFeedbackDemoResponses: InferInsertModel<typeof surveyResponses>[] = DEMO_RESPONSES.map((response, index) => ({
	id: opaqueId("srvr", `response:${index}`),
	surveyId: DEMO_SURVEY_ID,
	submittedAt: response.day,
	source: response.source,
}));

export const seedFeedbackDemoAnswers: InferInsertModel<typeof surveyAnswers>[] = DEMO_RESPONSES.flatMap((response, index) => {
	const responseId = opaqueId("srvr", `response:${index}`);
	const answer = (position: number, value: string, hidden = false): InferInsertModel<typeof surveyAnswers> => ({
		id: opaqueId("srva", `answer:${index}:${position}`),
		responseId,
		questionId: `srvq_demo_past_${position}`,
		value,
		hiddenFromOrganizers: hidden,
	});
	return [
		...response.ratings.map((rating, ratingIndex) => answer(ratingIndex + 1, String(rating))),
		...(response.valuable ? [answer(6, response.valuable)] : []),
		...(response.change ? [answer(7, response.change, response.hideChange === true)] : []),
	];
});

// 24 invited, 5 of whom answered (21%, so the low-response caution shows), plus the three walk-ins who answered from the event page.
const DEMO_COMPLETED_AT = [
	"2026-09-27T03:20:00.000Z",
	"2026-09-27T05:45:00.000Z",
	"2026-09-27T11:10:00.000Z",
	"2026-09-27T14:30:00.000Z",
	"2026-09-28T02:05:00.000Z",
].map((at) => new Date(at));
const DEMO_WALK_IN_COMPLETED_AT = ["2026-09-27T07:00:00.000Z", "2026-09-28T04:00:00.000Z", "2026-09-28T09:40:00.000Z"].map((at) => new Date(at));

export const seedFeedbackDemoAssignments: InferInsertModel<typeof surveyAssignments>[] = [
	...Array.from({ length: INVITED_COUNT }, (_, index) => ({
		surveyId: DEMO_SURVEY_ID,
		memberId: attendeeId(index + 1),
		assignedAt: DEMO_SENT_AT,
		completedAt: DEMO_COMPLETED_AT[index] ?? null,
		source: "invited" as const,
	})),
	...DEMO_WALK_IN_COMPLETED_AT.map((completedAt, index) => ({
		surveyId: DEMO_SURVEY_ID,
		memberId: attendeeId(INVITED_COUNT + index + 1),
		assignedAt: completedAt,
		completedAt,
		source: "walk_in" as const,
	})),
];

// Everyone invited and every walk-in checked in to the event, so the eligible and attendee counts are real. Check-ins
// fall inside the event window (07:00 to 10:00 UTC), three minutes apart.
export const seedFeedbackDemoAttendance: InferInsertModel<typeof crsAttendance>[] = seedFeedbackDemoMembers.map((member, index) => ({
	eventId: DEMO_EVENT_ID,
	memberId: member.id,
	scannedAt: new Date(seedFeedbackDemoEvents[0].startsAt.getTime() + (5 + index * 3) * 60_000),
	scannedBy: "mem_demo_admin",
}));

export const seedFeedbackDemoDebriefs: InferInsertModel<typeof eventDebriefs>[] = [
	{
		eventId: DEMO_EVENT_ID,
		intended: "Teach first-years a repeatable way to structure a market-entry case, then let them practise one live.",
		happened: "The framework talk ran long, so only one practice case fit. The sound cut out twice and the room was too small for the turnout.",
		why: "We started late waiting on equipment, and we booked the room before the sign-up count was known.",
		change: "Book a bigger room once sign-ups pass 40, test the audio the day before, and cut the talk to 20 minutes so two cases fit.",
		updatedBy: "mem_demo_admin",
		updatedAt: new Date("2026-09-29T02:00:00.000Z"),
	},
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
