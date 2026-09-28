import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createId } from "@/lib/ids";
import { getCloudflareEnv } from "@/server/cloudflare";
import { members } from "../schema";
import type { CreateMemberInput, DatabaseAdapter, Member, UpdateMemberProfileInput } from "../types";

export class D1DatabaseAdapter implements DatabaseAdapter {
	readonly adapterType = "d1-binding" as const;

	private db() {
		const env = getCloudflareEnv();
		if (!env.DB) {
			throw new Error("Cloudflare D1 binding DB is unavailable.");
		}
		return drizzle(env.DB, { schema: { members } });
	}

	async listMembers(): Promise<Member[]> {
		return this.db().select().from(members).orderBy(members.createdAt);
	}

	async createMember(input: CreateMemberInput): Promise<Member> {
		const id = createId("mem");
		const [created] = await this.db().insert(members).values({ id, email: input.email, name: input.name ?? null }).returning();
		return created;
	}

	async getMemberById(id: string): Promise<Member | null> {
		const [member] = await this.db().select().from(members).where(eq(members.id, id)).limit(1);
		return member ?? null;
	}

	async updateMemberProfile(id: string, input: UpdateMemberProfileInput): Promise<Member> {
		const [member] = await this.db().update(members).set({ ...input, updatedAt: new Date() }).where(eq(members.id, id)).returning();
		if (!member) throw new Error("Member not found.");
		return member;
	}
}
