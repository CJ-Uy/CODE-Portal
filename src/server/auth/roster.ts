import { eq } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { members } from "@/db/schema";

type MemberUpdate = Partial<InferInsertModel<typeof members>>;

type Db = {
	select(columns: { id: typeof members.id }): {
		from(table: typeof members): {
			where(condition: unknown): {
				limit(n: number): Promise<{ id: string }[]> | { id: string }[];
			};
		};
	};
	update(table: typeof members): {
		set(value: MemberUpdate): {
			where(condition: unknown): Promise<unknown> | unknown;
		};
	};
};

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Term roster auth is on hold. For now, member access is the same simple
 * gate as prod: if an email is in the member list, it can sign in.
 */
export async function isRosterSignInAllowed(
	db: Db,
	email: string,
	_now: Date = new Date(),
	bootstrapEmail?: string,
): Promise<boolean> {
	void _now;
	const normalized = normalizeEmail(email);
	if (bootstrapEmail && normalized === normalizeEmail(bootstrapEmail)) return true;

	const [existing] = await db.select({ id: members.id }).from(members).where(eq(members.email, normalized)).limit(1);
	return Boolean(existing);
}

export async function syncSignedInMemberProfile(
	db: Pick<Db, "update">,
	profile: { email?: string | null; name?: unknown; picture?: unknown },
): Promise<void> {
	if (!profile.email) return;
	const update: MemberUpdate = { status: "active", updatedAt: new Date() };
	if (typeof profile.name === "string" && profile.name.trim()) update.name = profile.name.trim();
	if (typeof profile.picture === "string" && profile.picture.trim()) update.image = profile.picture.trim();
	await db.update(members).set(update).where(eq(members.email, normalizeEmail(profile.email)));
}
