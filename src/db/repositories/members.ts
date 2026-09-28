import { and, eq, like, or } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { members } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { CreateMemberInput, Member, UpdateMemberProfileInput } from "../types";
import type { AuditRepository } from "./audit";

type MemberInsert = InferInsertModel<typeof members>;

export type MemberDb = {
	select(): {
		from(table: typeof members): {
			orderBy(column: typeof members.createdAt): { limit(limit: number): Promise<Member[]> | Member[] };
			where(condition: unknown): { limit(limit: number): Promise<Member[]> | Member[] };
		};
	};
	insert(table: typeof members): {
		values(value: MemberInsert): {
			returning(): Promise<Member[]> | Member[];
		};
	};
	update(table: typeof members): {
		set(value: Partial<MemberInsert>): {
			where(condition: unknown): {
				returning(): Promise<Member[]> | Member[];
			};
		};
	};
	delete(table: typeof members): {
		where(condition: unknown): Promise<unknown> | unknown;
	};
};

export type MembersRepository = {
	list(actor: Actor, input?: { limit?: number }): Promise<Member[]>;
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
			return db.select().from(members).orderBy(members.createdAt).limit(Math.min(input?.limit ?? 25, 50));
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
