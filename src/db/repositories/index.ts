import { createAnnouncementsRepository, createUnavailableAnnouncementsRepository } from "./announcements";
import { createAuditRepository, createUnavailableAuditRepository } from "./audit";
import { createCalendarRepository, type CalendarRepository } from "./calendar";
import { createEventForumRepository } from "./event-forum";
import { createEventMediaRepository } from "./event-media";
import { createEventsRepository } from "./events";
import { createEventTypeRulesRepository } from "./eventTypeRules";
import { createLibraryRepository, createUnavailableLibraryRepository } from "./library";
import { createLinksRepository, createUnavailableLinksRepository, type LinkDb } from "./links";
import { createMembersRepository } from "./members";
import { createNavPinsRepository } from "./navPins";
import { createNotificationsRepository, type NotificationsRepository } from "./notifications";
import { createOverviewRepository, type OverviewRepository } from "./overview";
import { createPointTypesRepository } from "./pointTypes";
import { createQuickLinksRepository } from "./quickLinks";
import { createRetentionRepository } from "./retention";
import { createUnavailableRetentionRepository } from "./retention-unavailable";
import { createRolesRepository } from "./roles";
import { createRosterRepository } from "./roster";
import { createSessionsRepository } from "./sessions";
import { createSubmissionsRepository, createUnavailableSubmissionsRepository } from "./submissions";
import { createSurveysRepository, createUnavailableSurveysRepository } from "./surveys";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { MemberDb } from "./members";
import type { AuditDb } from "./audit";
import type { getDb } from "../client";
import type * as schema from "../schema";
import type { DatabaseAdapter } from "../types";

type DrizzleDb = ReturnType<typeof getDb>;

export function createDrizzleRepositories(db: DrizzleDb) {
	// getDb() is typed as the union of the sync better-sqlite3 and async D1
	// Drizzle clients. The notifications/overview/audit repos type their handle as
	// the async D1 client (what production and the tests run on); narrow once here,
	// mirroring the existing members cast. The local handle stays compatible at
	// runtime.
	const d1 = db as unknown as DrizzleD1Database<typeof schema>;
	const audit = createAuditRepository(d1);
	const retention = createRetentionRepository(db, audit);
	return {
		members: createMembersRepository(db as unknown as MemberDb & AuditDb, audit),
		sessions: createSessionsRepository(),
		links: createLinksRepository(db as unknown as LinkDb, audit),
		events: createEventsRepository(db, audit),
		eventMedia: createEventMediaRepository(db, audit),
		eventForum: createEventForumRepository(db, audit),
		eventTypeRules: createEventTypeRulesRepository(db, audit),
		pointTypes: createPointTypesRepository(db, audit),
		retention,
		navPins: createNavPinsRepository(db, audit),
		quickLinks: createQuickLinksRepository(db, audit),
		roster: createRosterRepository(db, audit),
		roles: createRolesRepository(d1),
		surveys: createSurveysRepository(d1, audit),
		notifications: createNotificationsRepository(d1),
		overview: createOverviewRepository(d1),
		calendar: createCalendarRepository(d1),
		announcements: createAnnouncementsRepository(d1, audit),
		library: createLibraryRepository(d1, audit),
		submissions: createSubmissionsRepository(d1),
		audit,
	};
}

export type Repositories = ReturnType<typeof createDrizzleRepositories>;

function createUnavailableNotificationsRepository(): NotificationsRepository {
	const unavailable = () => {
		throw new Error("Notifications are unavailable through this repository adapter.");
	};
	return {
		listFeed: unavailable,
		unreadCount: unavailable,
		markRead: unavailable,
		markAllRead: unavailable,
	};
}

function createUnavailableOverviewRepository(): OverviewRepository {
	return {
		getSummary() {
			throw new Error("Overview is unavailable through this repository adapter.");
		},
	};
}

// ponytail: shared-mode parity for calendar reads lands with adapter wiring, not here.
function createUnavailableCalendarRepository(): CalendarRepository {
	const unavailable = () => {
		throw new Error("Calendar is unavailable through this repository adapter.");
	};
	return { getMonth: unavailable, getEvent: unavailable };
}

export function createSharedRepositories(adapter: DatabaseAdapter): Repositories {
	const audit = createUnavailableAuditRepository();
	const unavailable = () => {
		throw new Error("This operation is only available through the shared /internal API.");
	};
	return {
		members: {
			list: async (_actor, input) => adapter.listMembers().then((members) => members.slice(0, input?.limit ?? 25)),
			search: async () => {
				// Admin-critical read: fail loud in shared-dev rather than returning [] (spec §5).
				throw new Error("Member search is only available through the shared /internal API.");
			},
			getById: async (_actor, id) => adapter.getMemberById(id),
			create: async (_actor, input) => adapter.createMember(input),
			updateProfile: async (_actor, id, input) => adapter.updateMemberProfile(id, input),
			delete: async () => {
				throw new Error("Member deletion is unavailable through this repository adapter.");
			},
		},
		sessions: createSessionsRepository(),
		links: createUnavailableLinksRepository(),
		events: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createEventsRepository>,
		eventMedia: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createEventMediaRepository>,
		eventForum: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createEventForumRepository>,
		eventTypeRules: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createEventTypeRulesRepository>,
		pointTypes: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createPointTypesRepository>,
		retention: createUnavailableRetentionRepository(),
		navPins: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createNavPinsRepository>,
		quickLinks: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createQuickLinksRepository>,
		roster: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createRosterRepository>,
		roles: new Proxy({}, { get: () => unavailable }) as ReturnType<typeof createRolesRepository>,
		surveys: createUnavailableSurveysRepository(),
		notifications: createUnavailableNotificationsRepository(),
		overview: createUnavailableOverviewRepository(),
		calendar: createUnavailableCalendarRepository(),
		announcements: createUnavailableAnnouncementsRepository(),
		library: createUnavailableLibraryRepository(),
		submissions: createUnavailableSubmissionsRepository(),
		audit,
	};
}
