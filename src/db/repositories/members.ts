import { and, desc, eq, like, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { createId } from "@/lib/ids";
import type * as schema from "@/db/schema";
import { members } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { CreateMemberInput, Member, MemberPage, MemberPageInput, UpdateMemberProfileInput } from "../types";
import type { AuditRepository } from "./audit";

export type MemberDb = DrizzleD1Database<typeof schema>;

export type MembersRepository = {
	list(actor: Actor, input?: { limit?: number }): Promise<Member[]>;
	listPage(actor: Actor, input?: MemberPageInput): Promise<MemberPage>;
	/**
	 * Active members only by default. Pass includeInactive to also match pending and
	 * inactive rows, which the roles page needs: someone can be granted access before
	 * they are activated, and excluding them made them impossible to find at all.
	 */
	search(actor: Actor, query: string, options?: { includeInactive?: boolean }): Promise<Member[]>;
	getById(actor: Actor, id: string): Promise<Member | null>;
	create(actor: Actor, input: CreateMemberInput): Promise<Member>;
	updateProfile(actor: Actor, id: string, input: UpdateMemberProfileInput): Promise<Member>;
	delete(actor: Actor, id: string): Promise<void>;
};

export function createMembersRepository(db: MemberDb, audit: AuditRepository): MembersRepository {
	return {
		async list(actor, input) {
			if (!can(actor, "member:manage")) {
				throw new Error("Not authorized to list members.");
			}
			return db.select().from(members).orderBy(desc(members.createdAt)).limit(Math.min(input?.limit ?? 25, 50));
		},
		async listPage(actor, input) {
			if (!can(actor, "member:manage")) throw new Error("Not authorized to list members.");
			const q = input?.q?.trim().toLowerCase() ?? "";
			const pattern = `%${q}%`;
			const matches = q ? or(
				like(members.email, pattern),
				like(members.name, pattern),
				like(members.fullName, pattern),
				like(members.nickname, pattern),
				like(members.status, pattern),
			) : undefined;
			const pageSize = Math.min(Math.max(input?.pageSize ?? 25, 1), 100);
			const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(members).where(matches);
			const page = Math.min(Math.max(input?.page ?? 1, 1), Math.max(1, Math.ceil(total / pageSize)));
			const rows = await db.select().from(members).where(matches)
				.orderBy(desc(members.createdAt), desc(members.id))
				.limit(pageSize).offset((page - 1) * pageSize);
			return { members: rows, total, page, pageSize };
		},
		async search(actor, query, options) {
			// Roles page authorizes on its own permission; member management also allowed.
			if (!can(actor, "role:assign") && !can(actor, "member:manage")) {
				throw new Error("Not authorized to search members.");
			}
			const q = query.trim().toLowerCase();
			if (q.length < 2) return [];
			const pattern = `%${q}%`;
			const matchesName = or(
				like(members.name, pattern),
				like(members.fullName, pattern),
				like(members.nickname, pattern),
				like(members.email, pattern),
			);
			// SQLite LIKE is case-insensitive for ASCII; capped at 20.
			return db
				.select()
				.from(members)
				.where(options?.includeInactive ? matchesName : and(eq(members.status, "active"), matchesName))
				.limit(20);
		},
		async getById(actor, id) {
			if (actor.memberId !== id && !can(actor, "member:manage")) {
				throw new Error("Not authorized to read this member.");
			}
			const [member] = await db.select().from(members).where(eq(members.id, id)).limit(1);
			return member ?? null;
		},
		async create(actor, input) {
			if (!can(actor, "member:manage")) {
				throw new Error("Not authorized to create members.");
			}
			const email = input.email.trim().toLowerCase();
			const [existing] = await db.select().from(members).where(eq(members.email, email)).limit(1);
			if (existing) return existing;
			const [member] = await db.insert(members).values({ id: createId("mem"), email, name: input.name ?? null, status: "inactive" }).returning();
			await audit.record(actor, {
				action: "member:create",
				targetType: "member",
				targetId: member.id,
				category: "member",
			});
			return member;
		},
		async updateProfile(actor, id, input) {
			if (actor.memberId !== id && !can(actor, "member:manage")) {
				throw new Error("Not authorized to update this member.");
			}
			const [member] = await db
				.update(members)
				.set({ ...input, updatedAt: new Date() })
				.where(eq(members.id, id))
				.returning();
			if (!member) {
				throw new Error("Member not found.");
			}
			await audit.record(actor, {
				action: "member:profile_update",
				targetType: "member",
				targetId: member.id,
				category: "member",
			});
			return member;
		},
		async delete(actor, id) {
			if (!can(actor, "member:manage")) {
				throw new Error("Not authorized to delete members.");
			}
			if (actor.memberId === id) {
				throw new Error("You cannot delete your own member record.");
			}
			await db.delete(members).where(eq(members.id, id));
			await audit.record(actor, {
				action: "member:delete",
				targetType: "member",
				targetId: id,
				category: "member",
			});
		},
	};
}
