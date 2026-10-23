import { and, count, eq, gt, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { crsAttendance, crsEvents, eventMedia, eventRsvps, eventTypeRules, members, terms } from "@/db/schema";
import type { EventStatus, EventType, RsvpState } from "@/db/schema";
import { can, type Actor } from "@/server/auth/permissions";
import { inclusiveEndDate, monthRange, toIsoDate, type CalendarItem } from "@/lib/calendar";
import { BIRTHDAY_EVENT_TYPE } from "./eventTypeRules";
import type { EventSignupAnswers, EventSignupField } from "@/lib/event-signup-form";

type Db = DrizzleD1Database<typeof schema>;

export type EventDetail = {
	id: string;
	title: string;
	type: EventType;
	status: EventStatus;
	points: number | null;
	place: string;
	capacity: number | null;
	startsAt: Date;
	endsAt: Date | null;
	allDay: boolean;
	readOnly: boolean;
	publicCode: string | null;
	description: string;
	rsvpForm: EventSignupField[];
	rsvpResponsesPublic: boolean;
	myRsvpAnswers: EventSignupAnswers;
	myRsvp: RsvpState;
	attendingCount: number;
	iAttended: boolean;
	media: Array<{ id: string; r2Key: string; caption: string | null }>;
};

function birthdayInMonth(birthday: string | null, year: number, month: number): string | null {
	if (!birthday) return null;
	const monthPart = birthday.slice(5, 7);
	const dayPart = birthday.slice(8, 10);
	if (Number(monthPart) !== month) return null;
	return `${year}-${monthPart}-${dayPart}`;
}

export type CalendarRepository = {
	getMonth(actor: Actor, input: { year: number; month: number }): Promise<CalendarItem[]>;
	getEvent(actor: Actor, eventId: string): Promise<EventDetail | null>;
};

export function createCalendarRepository(db: Db): CalendarRepository {
	return {
		async getMonth(actor, input) {
			const { start, end } = monthRange(input.year, input.month);
			const items: CalendarItem[] = [];

			const canSeePrivate = can(actor, "member:manage");
			// The four reads are independent, so they share one D1 round trip instead of four.
			const [events, [birthdayType], memberRows, termRows] = await Promise.all([
				// Select by OVERLAP, not by start, so an event running in from the previous month is
				// visible. monthRange is half-open [start, end), so a span ending exactly at `start` has
				// zero overlap and must be excluded — hence the strict `>` for a real end, while a
				// point-in-time event (null endsAt) starting exactly at `start` is inside the month.
				db
					.select({
						id: crsEvents.id,
						title: crsEvents.title,
						startsAt: crsEvents.startsAt,
						endsAt: crsEvents.endsAt,
						readOnly: crsEvents.readOnly,
						colour: eventTypeRules.colour,
					})
					.from(crsEvents)
					.leftJoin(eventTypeRules, eq(eventTypeRules.type, crsEvents.type))
					.where(
						and(
							isNull(crsEvents.deletedAt),
							lt(crsEvents.startsAt, end),
							or(
								and(isNull(crsEvents.endsAt), gte(crsEvents.startsAt, start)),
								and(isNotNull(crsEvents.endsAt), gt(crsEvents.endsAt, start)),
							),
						),
					),
				// Birthdays are synthesized rather than stored as events, but they still answer to the
				// admin-managed `birthday` type row for colour. A missing row degrades to accent.
				db.select({ colour: eventTypeRules.colour }).from(eventTypeRules).where(eq(eventTypeRules.type, BIRTHDAY_EVENT_TYPE)),
				db
					.select({ id: members.id, name: members.name, birthday: members.birthday, birthdayPrivate: members.birthdayPrivate })
					.from(members),
				db
					.select({ id: terms.id, name: terms.name, endsAt: terms.endsAt })
					.from(terms)
					.where(and(gte(terms.endsAt, start), lt(terms.endsAt, end))),
			]);

			for (const event of events) {
				items.push({
					id: `event:${event.id}`,
					source: "event",
					title: event.title,
					date: toIsoDate(event.startsAt),
					endDate: inclusiveEndDate(event.startsAt, event.endsAt),
					startsAt: event.startsAt.toISOString(),
					endsAt: event.endsAt ? event.endsAt.toISOString() : null,
					eventId: event.id,
					href: `/portal/calendar/${event.id}`,
					// A retired or missing type row degrades to slate rather than blanking the grid.
					colour: event.colour || "slate",
					readOnly: Boolean(event.readOnly),
				});
			}

			const birthdayColour = birthdayType?.colour || "accent";
			for (const member of memberRows) {
				if (member.birthdayPrivate && !canSeePrivate) continue;
				const date = birthdayInMonth(member.birthday, input.year, input.month);
				if (!date) continue;
				items.push({
					id: `birthday:${member.id}`,
					source: "birthday",
					title: `${member.name ?? "Member"} birthday`,
					date,
					endDate: date,
					startsAt: null,
					endsAt: null,
					eventId: null,
					href: null,
					colour: birthdayColour,
					readOnly: false,
				});
			}

			for (const term of termRows) {
				items.push({
					id: `term_deadline:${term.id}`,
					source: "term_deadline",
					title: `${term.name} ends`,
					date: toIsoDate(term.endsAt),
					endDate: toIsoDate(term.endsAt),
					startsAt: null,
					endsAt: null,
					eventId: null,
					href: null,
					colour: "rose",
					readOnly: false,
				});
			}

			items.sort((a, b) => a.date.localeCompare(b.date));
			return items;
		},

		async getEvent(actor, eventId) {
			// The side reads only need the id, so they go out with the event read rather than after it.
			// A missing event wastes four empty reads, which is cheaper than four extra round trips.
			const [[event], [myRsvp], [attending], [mine], media] = await Promise.all([
				db.select().from(crsEvents).where(eq(crsEvents.id, eventId)).limit(1),
				db
					.select({ state: eventRsvps.state, answers: eventRsvps.answersJson })
					.from(eventRsvps)
					.where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.memberId, actor.memberId)))
					.limit(1),
				db
					.select({ value: count() })
					.from(eventRsvps)
					.where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.state, "going"))),
				db
					.select({ memberId: crsAttendance.memberId })
					.from(crsAttendance)
					.where(and(eq(crsAttendance.eventId, eventId), eq(crsAttendance.memberId, actor.memberId)))
					.limit(1),
				db
					.select({ id: eventMedia.id, r2Key: eventMedia.r2Key, caption: eventMedia.caption })
					.from(eventMedia)
					.where(eq(eventMedia.eventId, eventId)),
			]);
			if (!event || event.deletedAt) return null;

			return {
				id: event.id,
				title: event.title,
				type: event.type,
				status: event.status,
				points: event.points,
				place: event.place,
				capacity: event.capacity,
				startsAt: event.startsAt,
				endsAt: event.endsAt,
				allDay: Boolean(event.allDay),
				readOnly: Boolean(event.readOnly),
				publicCode: event.publicCode ?? null,
				description: event.description,
				rsvpForm: event.rsvpFormJson ?? [],
				rsvpResponsesPublic: event.rsvpResponsesPublic,
				myRsvpAnswers: myRsvp?.answers ?? {},
				myRsvp: myRsvp?.state ?? "none",
				attendingCount: attending?.value ?? 0,
				iAttended: Boolean(mine),
				media,
			};
		},
	};
}
