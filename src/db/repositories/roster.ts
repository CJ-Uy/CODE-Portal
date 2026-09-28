import { and, asc, eq, inArray } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { members, termMemberRoster } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

export type RosterEntry = InferSelectModel<typeof termMemberRoster>;

export type RosterAddInput = {
	termId: string;
	email: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RosterDb = any;

export type RosterRepository = {
	listForTerm(actor: Actor, termId: string): Promise<RosterEntry[]>;
	add(actor: Actor, input: RosterAddInput): Promise<RosterEntry>;
	bulkAdd(actor: Actor, input: { termId: string; emails: string[] }): Promise<{ added: number; alreadyMembers: number }>;
	remove(actor: Actor, termId: string, email: string): Promise<void>;
};

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function createRosterRepository(db: RosterDb, audit: AuditRepository): RosterRepository {
	return {
		async listForTerm(actor, termId) {
			if (!can(actor, "roster:manage")) {
				throw new Error("Not authorized to list the roster.");
			}
			return db
				.select()
				.from(termMemberRoster)
				.where(eq(termMemberRoster.termId, termId))
				.orderBy(asc(termMemberRoster.email));
		},
		async add(actor, input) {
			if (!can(actor, "roster:manage")) {
				throw new Error("Not authorized to edit the roster.");
			}
			const email = normalizeEmail(input.email);
			const [existingMember] = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
			await db
				.insert(termMemberRoster)
				.values({ termId: input.termId, email, memberId: existingMember?.id ?? null, addedBy: actor.memberId })
				.onConflictDoNothing();
			await audit.record(actor, {
				action: "roster:add",
				targetType: "term_member_roster",
				targetId: `${input.termId}:${email}`,
				category: "retention",
			});
			const [entry] = await db
				.select()
				.from(termMemberRoster)
				.where(and(eq(termMemberRoster.termId, input.termId), eq(termMemberRoster.email, email)))
				.orderBy(asc(termMemberRoster.email));
			return entry;
		},
		async bulkAdd(actor, input) {
			if (!can(actor, "roster:manage")) {
				throw new Error("Not authorized to edit the roster.");
			}
			const emails = [...new Set(input.emails.map(normalizeEmail).filter((e) => e.length > 0))];
			if (emails.length > 500) {
				throw new Error("Too many emails (max 500 per submission). Split into smaller batches.");
			}
			if (emails.length === 0) return { added: 0, alreadyMembers: 0 };

			// Stay under D1's ~100 bound-param / statement budget.
			const CHUNK = 80;
			const chunk = <T>(arr: T[]): T[][] => {
				const out: T[][] = [];
				for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
				return out;
			};

			const existing = new Set<string>();
			for (const part of chunk(emails)) {
				const rows: { email: string }[] = await db
					.select({ email: termMemberRoster.email })
					.from(termMemberRoster)
					.where(and(eq(termMemberRoster.termId, input.termId), inArray(termMemberRoster.email, part)));
				for (const row of rows) existing.add(row.email);
			}
			const toInsert = emails.filter((email) => !existing.has(email));

			const idByEmail = new Map<string, string>();
			for (const part of chunk(toInsert)) {
				if (part.length === 0) continue;
				const rows: { id: string; email: string }[] = await db
					.select({ id: members.id, email: members.email })
					.from(members)
					.where(inArray(members.email, part));
				for (const row of rows) idByEmail.set(row.email, row.id);
			}

			for (const part of chunk(toInsert)) {
				if (part.length === 0) continue;
				await db
					.insert(termMemberRoster)
					.values(
						part.map((email) => ({
							termId: input.termId,
							email,
							memberId: idByEmail.get(email) ?? null,
							addedBy: actor.memberId,
						})),
					)
					.onConflictDoNothing();
			}

			await audit.record(actor, {
				action: "roster:bulk_add",
				targetType: "term_member_roster",
				targetId: input.termId,
				category: "retention",
				detail: `added ${toInsert.length}, already ${existing.size}`,
			});
			return { added: toInsert.length, alreadyMembers: existing.size };
		},
		async remove(actor, termId, email) {
			if (!can(actor, "roster:manage")) {
				throw new Error("Not authorized to edit the roster.");
			}
			const normalized = normalizeEmail(email);
			await db
				.delete(termMemberRoster)
				.where(and(eq(termMemberRoster.termId, termId), eq(termMemberRoster.email, normalized)));
			await audit.record(actor, {
				action: "roster:remove",
				targetType: "term_member_roster",
				targetId: `${termId}:${normalized}`,
				category: "retention",
			});
		},
	};
}
