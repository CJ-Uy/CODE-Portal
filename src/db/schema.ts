import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { EventSignupAnswers, EventSignupField } from "@/lib/event-signup-form";
import type { PointMilestone } from "@/lib/point-milestones";

export type MemberStatus = "active" | "pending" | "inactive";
/** The three types seeded by migration 0010; kept for seeding and tests only. Event types are data now - see event_type_rules. */
export const seedEventTypes = ["official", "casual", "birthday"] as const;
/** An event type is now an admin-managed key, validated at runtime against event_type_rules. */
export type EventType = string;
export type EventStatus = "pending" | "approved" | "rejected";
export type RsvpState = "going" | "none";
export type SurveyStatus = "draft" | "running" | "closed";
export type SurveyQuestionType = "scale" | "text" | "choice";
export type AuditActorContext = "session" | "shared_dev_token";
export type AuditCategory =
	| "role"
	| "event"
	| "retention"
	| "survey"
	| "link"
	| "member"
	| "announcement"
	| "library";
export type RetentionRecordSource = "event_attendance" | "manual";

const nowMs = sql`(unixepoch() * 1000)`;

export const members = sqliteTable(
	"members",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		emailVerified: integer("email_verified", { mode: "timestamp_ms" }),
		name: text("name"),
		image: text("image"),
		fullName: text("full_name"),
		nickname: text("nickname"),
		pronouns: text("pronouns"),
		batch: text("batch"),
		birthday: text("birthday"),
		birthdayPrivate: integer("birthday_private", { mode: "boolean" }).notNull().default(true),
		avatarKey: text("avatar_key"),
		status: text("status").$type<MemberStatus>().notNull().default("active"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		uniqueIndex("members_email_unique").on(table.email),
		index("members_email_idx").on(table.email),
		index("members_status_idx").on(table.status),
	],
);

export const accounts = sqliteTable(
	"accounts",
	{
		userId: text("user_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		provider: text("provider").notNull(),
		providerAccountId: text("provider_account_id").notNull(),
		refresh_token: text("refresh_token"),
		access_token: text("access_token"),
		expires_at: integer("expires_at"),
		token_type: text("token_type"),
		scope: text("scope"),
		id_token: text("id_token"),
		session_state: text("session_state"),
	},
	(table) => [
		primaryKey({ columns: [table.provider, table.providerAccountId] }),
		index("accounts_user_id_idx").on(table.userId),
	],
);

export const sessions = sqliteTable(
	"sessions",
	{
		sessionToken: text("session_token").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const verificationToken = sqliteTable(
	"verification_token",
	{
		identifier: text("identifier").notNull(),
		token: text("token").notNull(),
		expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

export const roles = sqliteTable("roles", {
	id: text("id").primaryKey(),
	key: text("key").notNull().unique(),
	label: text("label").notNull(),
	description: text("description").notNull(),
	kind: text("kind").notNull(),
});

export const memberRoles = sqliteTable(
	"member_roles",
	{
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		roleId: text("role_id")
			.notNull()
			.references(() => roles.id, { onDelete: "cascade" }),
		assignedBy: text("assigned_by").references(() => members.id, { onDelete: "set null" }),
		assignedAt: integer("assigned_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [primaryKey({ columns: [table.memberId, table.roleId] }), index("member_roles_role_id_idx").on(table.roleId)],
);

/**
 * Roles granted to someone who has not signed in yet, so they arrive already able to do
 * their job. An invite is a term_member_roster row keyed by email with no members row at
 * all, so there is no member id to attach a role to until first sign-in. These rows are
 * claimed and deleted by the createUser event in auth.ts.
 *
 * Email is stored lowercased, matching how term_member_roster is queried.
 */
export const pendingMemberRoles = sqliteTable(
	"pending_member_roles",
	{
		email: text("email").notNull(),
		roleId: text("role_id")
			.notNull()
			.references(() => roles.id, { onDelete: "cascade" }),
		assignedBy: text("assigned_by").references(() => members.id, { onDelete: "set null" }),
		assignedAt: integer("assigned_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [primaryKey({ columns: [table.email, table.roleId] }), index("pending_member_roles_email_idx").on(table.email)],
);

export const sharedDevTokens = sqliteTable("shared_dev_tokens", {
	tokenHash: text("token_hash").primaryKey(),
	memberId: text("member_id")
		.notNull()
		.references(() => members.id, { onDelete: "cascade" }),
	label: text("label").notNull(),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const shortLinks = sqliteTable(
	"short_links",
	{
		id: text("id").primaryKey(),
		slug: text("slug").notNull().unique(),
		destinationUrl: text("destination_url").notNull(),
		title: text("title").notNull(),
		ownerMemberId: text("owner_member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		clickCount: integer("click_count").notNull().default(0),
		previewTitle: text("preview_title"),
		previewDescription: text("preview_description"),
		previewImageKey: text("preview_image_key"),
		tags: text("tags"),
		qrStyle: text("qr_style"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("short_links_slug_idx").on(table.slug), index("short_links_owner_member_id_idx").on(table.ownerMemberId)],
);

export const reservedSlugs = sqliteTable("reserved_slugs", {
	slug: text("slug").primaryKey(),
});

export const linkDailyStats = sqliteTable(
	"link_daily_stats",
	{
		linkId: text("link_id")
			.notNull()
			.references(() => shortLinks.id, { onDelete: "cascade" }),
		date: text("date").notNull(),
		referrerBucket: text("referrer_bucket").notNull(),
		deviceBucket: text("device_bucket").notNull(),
		count: integer("count").notNull().default(0),
	},
	(table) => [
		primaryKey({ columns: [table.linkId, table.date, table.referrerBucket, table.deviceBucket] }),
		index("link_daily_stats_link_date_idx").on(table.linkId, table.date),
	],
);

export const linkHourlyStats = sqliteTable(
	"link_hourly_stats",
	{
		linkId: text("link_id")
			.notNull()
			.references(() => shortLinks.id, { onDelete: "cascade" }),
		hour: text("hour").notNull(),
		referrerBucket: text("referrer_bucket").notNull(),
		deviceBucket: text("device_bucket").notNull(),
		count: integer("count").notNull().default(0),
	},
	(table) => [
		primaryKey({ columns: [table.linkId, table.hour, table.referrerBucket, table.deviceBucket] }),
		index("link_hourly_stats_link_hour_idx").on(table.linkId, table.hour),
	],
);

export const crsEvents = sqliteTable(
	"crs_events",
	{
		id: text("id").primaryKey(),
		title: text("title").notNull(),
		type: text("type").$type<EventType>().notNull(),
		status: text("status").$type<EventStatus>().notNull().default("pending"),
		points: integer("points"),
		place: text("place").notNull(),
		capacity: integer("capacity"),
		graceMinutes: integer("grace_minutes"),
		startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
		endsAt: integer("ends_at", { mode: "timestamp_ms" }),
		// Stored, not derived: "Aug 12 09:00 -> Aug 14 17:00" and "Aug 12-14, all day" both span
		// three days, and the edit form has to round-trip which one the author chose.
		allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
		// Informational event: no RSVP, check-in, attendance or points. Set via event:moderate.
		readOnly: integer("read_only", { mode: "boolean" }).notNull().default(false),
		// Short share code behind /events/<CODE>. Nullable so a row written by an older Worker
		// mid-deploy resolves as "not shareable" instead of throwing.
		publicCode: text("public_code"),
		description: text("description").notNull(),
		rsvpFormJson: text("rsvp_form_json", { mode: "json" }).$type<EventSignupField[]>().notNull().default([]),
		rsvpResponsesPublic: integer("rsvp_responses_public", { mode: "boolean" }).notNull().default(false),
		createdBy: text("created_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		approvedBy: text("approved_by").references(() => members.id, { onDelete: "set null" }),
		approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
		checkinSecret: text("checkin_secret").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		index("crs_events_status_idx").on(table.status),
		index("crs_events_starts_at_idx").on(table.startsAt),
		index("crs_events_ends_at_idx").on(table.endsAt),
		uniqueIndex("crs_events_public_code_idx").on(table.publicCode),
		index("crs_events_type_idx").on(table.type),
		index("crs_events_created_by_idx").on(table.createdBy),
	],
);

export const eventStaff = sqliteTable(
	"event_staff",
	{
		eventId: text("event_id")
			.notNull()
			.references(() => crsEvents.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		role: text("role").$type<"admin" | "scanner">().notNull(),
		addedBy: text("added_by").references(() => members.id, { onDelete: "set null" }),
		addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		primaryKey({ columns: [table.eventId, table.memberId] }),
		index("event_staff_member_id_idx").on(table.memberId),
		check("event_staff_role_check", sql`${table.role} in ('admin', 'scanner')`),
	],
);

export const eventInvites = sqliteTable(
	"event_invites",
	{
		eventId: text("event_id")
			.notNull()
			.references(() => crsEvents.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		invitedBy: text("invited_by").references(() => members.id, { onDelete: "set null" }),
		invitedAt: integer("invited_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		primaryKey({ columns: [table.eventId, table.memberId] }),
		index("event_invites_member_invited_idx").on(table.memberId, table.invitedAt),
	],
);

export const eventRsvps = sqliteTable(
	"event_rsvps",
	{
		eventId: text("event_id")
			.notNull()
			.references(() => crsEvents.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		state: text("state").$type<RsvpState>().notNull().default("none"),
		answersJson: text("answers_json", { mode: "json" }).$type<EventSignupAnswers>().notNull().default({}),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [primaryKey({ columns: [table.eventId, table.memberId] }), index("event_rsvps_member_id_idx").on(table.memberId)],
);

export const crsAttendance = sqliteTable(
	"crs_attendance",
	{
		eventId: text("event_id")
			.notNull()
			.references(() => crsEvents.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		scannedAt: integer("scanned_at", { mode: "timestamp_ms" }).notNull(),
		scannedBy: text("scanned_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.eventId, table.memberId] }), index("crs_attendance_member_id_idx").on(table.memberId)],
);

export const eventTypeRules = sqliteTable("event_type_rules", {
	type: text("type").$type<EventType>().primaryKey(),
	// NULL means any member may create this event type.
	requiredPermission: text("required_permission"),
	label: text("label").notNull().default(""),
	colour: text("colour").notNull().default("slate"),
	active: integer("active").notNull().default(1),
	position: integer("position").notNull().default(0),
	updatedBy: text("updated_by").references(() => members.id, { onDelete: "set null" }),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const eventMedia = sqliteTable(
	"event_media",
	{
		id: text("id").primaryKey(),
		eventId: text("event_id")
			.notNull()
			.references(() => crsEvents.id, { onDelete: "cascade" }),
		r2Key: text("r2_key").notNull(),
		caption: text("caption"),
		uploadedBy: text("uploaded_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("event_media_event_id_idx").on(table.eventId)],
);

export const eventForumPosts = sqliteTable(
	"event_forum_posts",
	{
		id: text("id").primaryKey(),
		eventId: text("event_id")
			.notNull()
			.references(() => crsEvents.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		anonymous: integer("anonymous", { mode: "boolean" }).notNull().default(false),
		parentId: text("parent_id"),
		body: text("body").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		index("event_forum_posts_event_created_idx").on(table.eventId, table.createdAt),
		index("event_forum_posts_parent_id_idx").on(table.parentId),
	],
);

export const terms = sqliteTable(
	"terms",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		retainedAt: integer("retained_at").notNull(),
		probationBelow: integer("probation_below").notNull(),
		startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
		endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [index("terms_starts_ends_idx").on(table.startsAt, table.endsAt)],
);

export const termMemberRoster = sqliteTable(
	"term_member_roster",
	{
		termId: text("term_id")
			.notNull()
			.references(() => terms.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		memberId: text("member_id").references(() => members.id, { onDelete: "set null" }),
		addedBy: text("added_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		primaryKey({ columns: [table.termId, table.email] }),
		index("term_member_roster_term_id_idx").on(table.termId),
		index("term_member_roster_email_idx").on(table.email),
	],
);

export const pointTypes = sqliteTable(
	"point_types",
	{
		id: text("id").primaryKey(),
		key: text("key").notNull().unique(),
		label: text("label").notNull(),
		milestonesJson: text("milestones_json", { mode: "json" }).$type<PointMilestone[]>().notNull().default([]),
		active: integer("active", { mode: "boolean" }).notNull().default(true),
		position: integer("position").notNull().default(0),
		updatedBy: text("updated_by").references(() => members.id, { onDelete: "set null" }),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
);

export const eventPointAwards = sqliteTable(
	"event_point_awards",
	{
		eventId: text("event_id").notNull().references(() => crsEvents.id, { onDelete: "cascade" }),
		pointTypeId: text("point_type_id").notNull().references(() => pointTypes.id),
		// real, not integer: awards carry fractions like 0.75. Quantised to 2dp on write by quantizePoints().
		points: real("points").notNull(),
	},
	(table) => [primaryKey({ columns: [table.eventId, table.pointTypeId] })],
);

export const retentionRecords = sqliteTable(
	"retention_records",
	{
		id: text("id").primaryKey(),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		termId: text("term_id")
			.notNull()
			.references(() => terms.id, { onDelete: "cascade" }),
		eventId: text("event_id").references(() => crsEvents.id, { onDelete: "set null" }),
		pointTypeId: text("point_type_id").notNull().default("pt_retention"),
		points: real("points"),
		reason: text("reason").notNull(),
		source: text("source").$type<RetentionRecordSource>().notNull().default("manual"),
		recordedBy: text("recorded_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		index("retention_records_member_term_idx").on(table.memberId, table.termId),
		index("retention_records_term_id_idx").on(table.termId),
		index("retention_records_event_id_idx").on(table.eventId),
		uniqueIndex("retention_records_event_member_type_idx")
			.on(table.eventId, table.memberId, table.pointTypeId)
			.where(sql`source = 'event_attendance'`),
	],
);

export const surveys = sqliteTable(
	"surveys",
	{
		id: text("id").primaryKey(),
		eventId: text("event_id").references(() => crsEvents.id, { onDelete: "set null" }),
		title: text("title").notNull(),
		status: text("status").$type<SurveyStatus>().notNull().default("draft"),
		sampleSize: integer("sample_size"),
		createdBy: text("created_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("surveys_status_idx").on(table.status), index("surveys_event_id_idx").on(table.eventId)],
);

export const surveyQuestions = sqliteTable(
	"survey_questions",
	{
		id: text("id").primaryKey(),
		surveyId: text("survey_id")
			.notNull()
			.references(() => surveys.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		type: text("type").$type<SurveyQuestionType>().notNull(),
		prompt: text("prompt").notNull(),
		optionsJson: text("options_json"),
	},
	(table) => [index("survey_questions_survey_id_idx").on(table.surveyId)],
);

export const surveyAssignments = sqliteTable(
	"survey_assignments",
	{
		surveyId: text("survey_id")
			.notNull()
			.references(() => surveys.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		responseTokenHash: text("response_token_hash").notNull().unique(),
		assignedAt: integer("assigned_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
	},
	(table) => [
		primaryKey({ columns: [table.surveyId, table.memberId] }),
		index("survey_assignments_member_id_idx").on(table.memberId),
		index("survey_assignments_response_token_hash_idx").on(table.responseTokenHash),
	],
);

export const surveyResponses = sqliteTable("survey_responses", {
	id: text("id").primaryKey(),
	surveyId: text("survey_id")
		.notNull()
		.references(() => surveys.id, { onDelete: "cascade" }),
	submittedAt: integer("submitted_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const surveyAnswers = sqliteTable("survey_answers", {
	id: text("id").primaryKey(),
	responseId: text("response_id")
		.notNull()
		.references(() => surveyResponses.id, { onDelete: "cascade" }),
	questionId: text("question_id")
		.notNull()
		.references(() => surveyQuestions.id, { onDelete: "cascade" }),
	value: text("value").notNull(),
});

export const notifications = sqliteTable(
	"notifications",
	{
		id: text("id").primaryKey(),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(),
		title: text("title").notNull(),
		body: text("body").notNull(),
		href: text("href"),
		readAt: integer("read_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("notifications_member_read_created_idx").on(table.memberId, table.readAt, table.createdAt)],
);

export const auditLogs = sqliteTable(
	"audit_logs",
	{
		id: text("id").primaryKey(),
		actorMemberId: text("actor_member_id").references(() => members.id, { onDelete: "set null" }),
		actorContext: text("actor_context").$type<AuditActorContext>().notNull().default("session"),
		sharedTokenHash: text("shared_token_hash"),
		sharedTokenLabel: text("shared_token_label"),
		action: text("action").notNull(),
		targetType: text("target_type").notNull(),
		targetId: text("target_id").notNull(),
		detail: text("detail"),
		targetMemberId: text("target_member_id").references(() => members.id, { onDelete: "set null" }),
		category: text("category").$type<AuditCategory>().notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		index("audit_logs_category_created_idx").on(table.category, table.createdAt),
		index("audit_logs_actor_member_id_idx").on(table.actorMemberId),
		index("audit_logs_target_member_created_idx").on(table.targetMemberId, table.createdAt),
		index("audit_logs_action_created_idx").on(table.action, table.createdAt),
	],
);

export const navPins = sqliteTable(
	"nav_pins",
	{
		id: text("id").primaryKey(),
		label: text("label").notNull(),
		url: text("url").notNull(),
		icon: text("icon").notNull(),
		position: integer("position").notNull().default(0),
		// Nullable with SET NULL so deleting a member clears authorship rather than
		// deleting their pins. Matches the shape already applied to staging and production.
		createdBy: text("created_by").references(() => members.id, { onDelete: "set null" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("nav_pins_position_idx").on(table.position)],
);

export const quickLinks = sqliteTable(
	"quick_links",
	{
		id: text("id").primaryKey(),
		label: text("label").notNull(),
		url: text("url").notNull(),
		position: integer("position").notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("quick_links_position_idx").on(table.position)],
);

export const rateLimitCounters = sqliteTable(
	"rate_limit_counters",
	{
		bucketKey: text("bucket_key").notNull(),
		windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
		count: integer("count").notNull().default(0),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		primaryKey({ columns: [table.bucketKey, table.windowStart] }),
		index("rate_limit_counters_window_start_idx").on(table.windowStart),
	],
);

export const announcements = sqliteTable(
	"announcements",
	{
		id: text("id").primaryKey(),
		tag: text("tag").notNull().default("CODE"),
		title: text("title").notNull(),
		body: text("body").notNull(),
		pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
		// Free-text display label only (e.g. "All members"); not enforced as a
		// permission filter — every signed-in member sees every announcement.
		audience: text("audience").notNull().default("all"),
		linkedEventId: text("linked_event_id").references(() => crsEvents.id, { onDelete: "set null" }),
		createdBy: text("created_by").references(() => members.id, { onDelete: "set null" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("announcements_pinned_idx").on(table.pinned, table.createdAt)],
);

export const announcementReads = sqliteTable(
	"announcement_reads",
	{
		announcementId: text("announcement_id")
			.notNull()
			.references(() => announcements.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		readAt: integer("read_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		primaryKey({ columns: [table.announcementId, table.memberId] }),
		index("announcement_reads_member_id_idx").on(table.memberId),
	],
);

export type LibraryKind = "article" | "case_study";
export type LibraryConfidentiality = "public" | "members" | "confidential";

export const libraryItems = sqliteTable(
	"library_items",
	{
		id: text("id").primaryKey(),
		kind: text("kind").$type<LibraryKind>().notNull().default("article"),
		confidentiality: text("confidentiality").$type<LibraryConfidentiality>().notNull().default("members"),
		category: text("category").notNull().default("General"),
		title: text("title").notNull(),
		dek: text("dek").notNull().default(""),
		readMinutes: integer("read_minutes").notNull().default(5),
		abstract: text("abstract").notNull().default(""),
		sectionsJson: text("sections_json", { mode: "json" }).$type<{ heading: string; body: string }[]>().notNull().default([]),
		componentsJson: text("components_json", { mode: "json" })
			.$type<{ name: string; definition: string; example: string }[]>()
			.notNull()
			.default([]),
		questionsJson: text("questions_json", { mode: "json" }).$type<string[]>().notNull().default([]),
		referencesJson: text("references_json", { mode: "json" }).$type<string[]>().notNull().default([]),
		topicsJson: text("topics_json", { mode: "json" }).$type<string[]>().notNull().default([]),
		createdBy: text("created_by").references(() => members.id, { onDelete: "set null" }),
		publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		index("library_items_category_idx").on(table.category),
		index("library_items_published_at_idx").on(table.publishedAt),
	],
);

export const libraryComments = sqliteTable(
	"library_comments",
	{
		id: text("id").primaryKey(),
		libraryItemId: text("library_item_id")
			.notNull()
			.references(() => libraryItems.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		// self-referential parent; plain text to avoid table self-FK ordering issues.
		parentId: text("parent_id"),
		anonymous: integer("anonymous", { mode: "boolean" }).notNull().default(false),
		body: text("body").notNull(),
		hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("library_comments_library_item_id_idx").on(table.libraryItemId)],
);

export const libraryFavorites = sqliteTable(
	"library_favorites",
	{
		memberId: text("member_id")
			.notNull()
			.references(() => members.id, { onDelete: "cascade" }),
		libraryItemId: text("library_item_id")
			.notNull()
			.references(() => libraryItems.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [primaryKey({ columns: [table.memberId, table.libraryItemId] })],
);

export const libraryLists = sqliteTable("library_lists", {
	id: text("id").primaryKey(),
	memberId: text("member_id")
		.notNull()
		.references(() => members.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	color: text("color").notNull().default("#0c315c"),
	createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const libraryListItems = sqliteTable(
	"library_list_items",
	{
		listId: text("list_id")
			.notNull()
			.references(() => libraryLists.id, { onDelete: "cascade" }),
		libraryItemId: text("library_item_id")
			.notNull()
			.references(() => libraryItems.id, { onDelete: "cascade" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [primaryKey({ columns: [table.listId, table.libraryItemId] })],
);

export const contactSubmissions = sqliteTable(
	"contact_submissions",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		organization: text("organization").notNull(),
		email: text("email").notNull(),
		// "within_ls" | "outside_ls" | "not_sure"
		orgSegment: text("org_segment").notNull(),
		message: text("message").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [index("contact_submissions_created_at_idx").on(table.createdAt)],
);

export const articleFeedback = sqliteTable(
	"article_feedback",
	{
		id: text("id").primaryKey(),
		// Articles are code-sourced (see src/content/site.ts), so feedback keys by
		// slug rather than a FK into a content table.
		articleSlug: text("article_slug").notNull(),
		rating: integer("rating").notNull(),
		comment: text("comment"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
	},
	(table) => [
		index("article_feedback_article_slug_idx").on(table.articleSlug),
		index("article_feedback_created_at_idx").on(table.createdAt),
	],
);
