import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "@/db/schema";
import { memberRoles, pendingMemberRoles } from "@/db/schema";

type Db = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema>;

export function normalizePendingEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Moves any roles granted to an email before that person had an account onto their new
 * member id, so they land already able to do the job they were invited for rather than
 * needing a second visit from an admin after their first sign-in.
 *
 * Called from the createUser event, which only fires for a genuinely new member, so the
 * grants are claimed exactly once and then removed.
 *
 * Returns the number of roles claimed, which the caller audits.
 */
export async function claimPendingRoles(db: Db, memberId: string, email: string): Promise<number> {
	const normalized = normalizePendingEmail(email);
	if (!normalized) return 0;

	const waiting = await db
		.select({ roleId: pendingMemberRoles.roleId, assignedBy: pendingMemberRoles.assignedBy })
		.from(pendingMemberRoles)
		.where(eq(pendingMemberRoles.email, normalized));
	if (waiting.length === 0) return 0;

	for (const row of waiting) {
		// onConflictDoNothing because the bootstrap grant may already have added a role,
		// and a duplicate must not fail the sign-in that triggered this.
		await db
			.insert(memberRoles)
			.values({ memberId, roleId: row.roleId, assignedBy: row.assignedBy ?? memberId })
			.onConflictDoNothing();
	}

	// Deleted rather than kept: the grant has been applied, and leaving the row would
	// re-apply it if the member were ever removed and re-created.
	await db.delete(pendingMemberRoles).where(eq(pendingMemberRoles.email, normalized));

	return waiting.length;
}
