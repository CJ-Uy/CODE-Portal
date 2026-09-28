import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "@/db/schema";
import { memberRoles, roles } from "@/db/schema";

type Db = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema>;

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function isBootstrapEmail(email?: string | null, configuredEmail?: string): boolean {
	return Boolean(email && configuredEmail && normalizeEmail(email) === normalizeEmail(configuredEmail));
}

export async function grantBootstrapSuperRole(
	db: Db,
	memberId: string,
	email: string,
	configuredEmail?: string,
): Promise<void> {
	if (!isBootstrapEmail(email, configuredEmail)) return;

	const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "super")).limit(1);
	if (!role) throw new Error("The super admin role is not seeded.");

	await db
		.insert(memberRoles)
		.values({ memberId, roleId: role.id, assignedBy: memberId })
		.onConflictDoNothing();
}
