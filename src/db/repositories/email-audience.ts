import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { crsAttendance, eventRsvps, memberRoles, members, roles, termMemberRoster, terms } from "@/db/schema";
import type { Audience, AudienceRule } from "@/lib/email/types";
import type * as schema from "../schema";

export type EmailDb = DrizzleD1Database<typeof schema>;

export type ResolvedRecipient = {
	memberId: string;
	email: string;
	name: string | null;
	fullName: string | null;
	nickname: string | null;
	batch: string | null;
};

// D1 binds at most 100 parameters per statement.
const ID_CHUNK = 90;

export function chunk<T>(items: T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

export function memberDisplayName(member: { email: string; name: string | null; fullName: string | null; nickname: string | null }): string {
	return member.nickname ?? member.fullName ?? member.name ?? member.email;
}

const toSet = (rows: { id: string | null }[]) => new Set(rows.map((row) => row.id).filter((id): id is string => id !== null));

async function currentTermId(db: EmailDb, now: Date): Promise<string | null> {
	const [term] = await db
		.select({ id: terms.id })
		.from(terms)
		.where(and(lte(terms.startsAt, now), gte(terms.endsAt, now)))
		.orderBy(desc(terms.startsAt))
		.limit(1);
	return term?.id ?? null;
}

async function idsForRule(db: EmailDb, rule: AudienceRule, now: Date): Promise<Set<string>> {
	switch (rule.kind) {
		case "member":
			return new Set([rule.memberId]);
		case "batch":
			return toSet(await db.select({ id: members.id }).from(members).where(eq(members.batch, rule.batch)));
		case "status":
			return toSet(await db.select({ id: members.id }).from(members).where(eq(members.status, rule.status)));
		case "role":
			return toSet(
				await db
					.select({ id: memberRoles.memberId })
					.from(memberRoles)
					.innerJoin(roles, eq(roles.id, memberRoles.roleId))
					.where(eq(roles.key, rule.roleKey)),
			);
		case "roster": {
			const termId = rule.termId === "current" ? await currentTermId(db, now) : rule.termId;
			if (!termId) return new Set();
			return toSet(
				await db
					.select({ id: termMemberRoster.memberId })
					.from(termMemberRoster)
					.where(and(eq(termMemberRoster.termId, termId), isNotNull(termMemberRoster.memberId))),
			);
		}
		case "event": {
			const going = toSet(
				await db
					.select({ id: eventRsvps.memberId })
					.from(eventRsvps)
					.where(and(eq(eventRsvps.eventId, rule.eventId), eq(eventRsvps.state, "going"))),
			);
			if (rule.relation === "rsvp") return going;
			const attended = toSet(await db.select({ id: crsAttendance.memberId }).from(crsAttendance).where(eq(crsAttendance.eventId, rule.eventId)));
			if (rule.relation === "attended") return attended;
			return new Set([...going].filter((id) => !attended.has(id)));
		}
	}
}

function intersect(sets: Set<string>[]): Set<string> {
	const [first, ...rest] = sets;
	return new Set([...(first ?? [])].filter((id) => rest.every((set) => set.has(id))));
}

export async function resolveAudience(db: EmailDb, audience: Audience, now: Date): Promise<ResolvedRecipient[]> {
	const picked = new Set(audience.include.flatMap((rule) => (rule.kind === "member" ? [rule.memberId] : [])));
	const groupRules = audience.include.filter((rule) => rule.kind !== "member");
	const groupSets = await Promise.all(groupRules.map((rule) => idsForRule(db, rule, now)));
	const matched =
		groupSets.length === 0 ? new Set<string>() : audience.match === "all" ? intersect(groupSets) : new Set(groupSets.flatMap((set) => [...set]));
	for (const id of picked) matched.add(id);
	for (const set of await Promise.all(audience.exclude.map((rule) => idsForRule(db, rule, now)))) {
		for (const id of set) matched.delete(id);
	}

	const allowInactive = audience.include.some((rule) => rule.kind === "status" && rule.status === "inactive");
	const rows = [];
	for (const part of chunk([...matched], ID_CHUNK)) {
		rows.push(
			...(await db
				.select({
					memberId: members.id,
					email: members.email,
					name: members.name,
					fullName: members.fullName,
					nickname: members.nickname,
					batch: members.batch,
					status: members.status,
				})
				.from(members)
				.where(inArray(members.id, part))),
		);
	}
	return rows
		.filter((row) => row.status !== "inactive" || allowInactive || picked.has(row.memberId))
		.map(({ status: _status, ...recipient }) => recipient)
		.sort((a, b) => a.email.localeCompare(b.email));
}
