import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { crsAttendance, eventRsvps, memberRoles, members, roles, surveyAssignments, termMemberRoster } from "@/db/schema";
import type { Audience, AudienceRule } from "@/lib/email/types";
import type * as schema from "../schema";

export type EmailDb = DrizzleD1Database<typeof schema>;

export type ResolvedRecipient = {
	/** Null for an outside recipient: a typed address that matches no member. */
	memberId: string | null;
	email: string;
	name: string | null;
	fullName: string | null;
	nickname: string | null;
	batch: string | null;
	external: boolean;
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

/** "Current member list" is everyone on the member list page, signed in or not; removing someone deletes them there. */
const isCurrentMemberList = (rule: AudienceRule) => rule.kind === "roster" && rule.termId === "current";

const typedEmails = (rules: AudienceRule[]) =>
	new Set(rules.flatMap((rule) => (rule.kind === "emails" ? rule.emails.map((email) => email.trim().toLowerCase()) : [])));

/** Lowercased address to member id, for the typed addresses that belong to a member. */
async function membersByEmail(db: EmailDb, emails: Set<string>): Promise<Map<string, string>> {
	const byEmail = new Map<string, string>();
	const lowerEmail = sql<string>`lower(${members.email})`;
	for (const part of chunk([...emails], ID_CHUNK)) {
		const rows = await db.select({ id: members.id, email: lowerEmail }).from(members).where(inArray(lowerEmail, part));
		for (const row of rows) byEmail.set(row.email, row.id);
	}
	return byEmail;
}

async function idsForRule(db: EmailDb, rule: AudienceRule): Promise<Set<string>> {
	switch (rule.kind) {
		case "member":
			return new Set([rule.memberId]);
		case "emails":
			return new Set((await membersByEmail(db, typedEmails([rule]))).values());
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
			if (isCurrentMemberList(rule)) return toSet(await db.select({ id: members.id }).from(members));
			// A named school year still reads the (shelved) term roster, for audiences saved before this change.
			return toSet(
				await db
					.select({ id: termMemberRoster.memberId })
					.from(termMemberRoster)
					.where(and(eq(termMemberRoster.termId, rule.termId), isNotNull(termMemberRoster.memberId))),
			);
		}
		case "survey_invitees":
			return toSet(
				await db
					.select({ id: surveyAssignments.memberId })
					.from(surveyAssignments)
					.where(and(eq(surveyAssignments.surveyId, rule.surveyId), eq(surveyAssignments.source, "invited"))),
			);
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

export async function resolveAudience(db: EmailDb, audience: Audience): Promise<ResolvedRecipient[]> {
	// Typed addresses behave like hand-picked members: always unioned in, never intersected.
	const typed = typedEmails(audience.include);
	const typedMembers = await membersByEmail(db, typed);
	const picked = new Set([...audience.include.flatMap((rule) => (rule.kind === "member" ? [rule.memberId] : [])), ...typedMembers.values()]);
	const groupRules = audience.include.filter((rule) => rule.kind !== "member" && rule.kind !== "emails");
	const groupSets = await Promise.all(groupRules.map((rule) => idsForRule(db, rule)));
	const matched =
		groupSets.length === 0 ? new Set<string>() : audience.match === "all" ? intersect(groupSets) : new Set(groupSets.flatMap((set) => [...set]));
	for (const id of picked) matched.add(id);
	for (const set of await Promise.all(audience.exclude.map((rule) => idsForRule(db, rule)))) {
		for (const id of set) matched.delete(id);
	}

	// Members who have not signed in yet are "inactive"; the member list includes them, other group rules do not.
	const allowInactive = audience.include.some((rule) => (rule.kind === "status" && rule.status === "inactive") || isCurrentMemberList(rule));
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
	const excludedEmails = typedEmails(audience.exclude);
	const outside = [...typed]
		.filter((email) => !typedMembers.has(email) && !excludedEmails.has(email))
		.map((email): ResolvedRecipient => ({ memberId: null, email, name: null, fullName: null, nickname: null, batch: null, external: true }));
	const recipients = [
		...rows
			.filter((row) => row.status !== "inactive" || allowInactive || picked.has(row.memberId))
			.map(({ status: _status, ...recipient }): ResolvedRecipient => ({ ...recipient, external: false })),
		...outside,
	];
	// One recipient per address; members come first, so a member wins over an outside address.
	const seen = new Set<string>();
	return recipients
		.filter((recipient) => {
			const key = recipient.email.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => a.email.localeCompare(b.email));
}
