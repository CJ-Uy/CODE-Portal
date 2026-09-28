import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { createId } from "@/lib/ids";
import { getAppConfig } from "@/server/env";
import { members } from "../schema";
import type { CreateMemberInput, DatabaseAdapter, Member, UpdateMemberProfileInput } from "../types";

type LocalDatabase = BetterSQLite3Database<{ members: typeof members }>;

export class LocalSqliteDatabaseAdapter implements DatabaseAdapter {
	readonly adapterType = "local-sqlite" as const;
	private dbInstance: LocalDatabase | null = null;

	private async db(): Promise<LocalDatabase> {
		if (this.dbInstance) return this.dbInstance;

		const [{ default: Database }, { drizzle }, fs] = await Promise.all([
			import("better-sqlite3"),
			import("drizzle-orm/better-sqlite3"),
			import("node:fs/promises"),
		]);
		const config = getAppConfig();
		await fs.mkdir(dirname(config.LOCAL_SQLITE_PATH), { recursive: true });
		const sqlite = new Database(config.LOCAL_SQLITE_PATH);
		this.dbInstance = drizzle(sqlite, { schema: { members } });
		return this.dbInstance;
	}

	async listMembers(): Promise<Member[]> {
		return (await this.db()).select().from(members).orderBy(members.createdAt).all();
	}

	async createMember(input: CreateMemberInput): Promise<Member> {
		const id = createId("mem");
		const created = (await this.db()).insert(members).values({ id, email: input.email, name: input.name ?? null }).returning().get();
		return created;
	}

	async getMemberById(id: string): Promise<Member | null> {
		const member = (await this.db()).select().from(members).where(eq(members.id, id)).limit(1).get();
		return member ?? null;
	}

	async updateMemberProfile(id: string, input: UpdateMemberProfileInput): Promise<Member> {
		const member = (await this.db()).update(members).set({ ...input, updatedAt: new Date() }).where(eq(members.id, id)).returning().get();
		if (!member) throw new Error("Member not found.");
		return member;
	}
}
