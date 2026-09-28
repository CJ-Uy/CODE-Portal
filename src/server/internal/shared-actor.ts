import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { memberRoles, members, roles, sharedDevTokens } from "@/db/schema";
import { normalizeRoleKeys, type Actor } from "@/server/auth/permissions";

export async function hashSharedToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function resolveSharedActor(
	db: DrizzleD1Database<typeof schema>,
	request: Request,
): Promise<Actor | null> {
	const authorization = request.headers.get("authorization");
	if (!authorization?.startsWith("Bearer ")) return null;

	const token = authorization.slice("Bearer ".length).trim();
	if (!token) return null;

	const tokenHash = await hashSharedToken(token);
	const rows = await db
		.select({
			memberId: sharedDevTokens.memberId,
			label: sharedDevTokens.label,
			status: members.status,
			role: roles.key,
		})
		.from(sharedDevTokens)
		.innerJoin(members, eq(members.id, sharedDevTokens.memberId))
		.leftJoin(memberRoles, eq(memberRoles.memberId, sharedDevTokens.memberId))
		.leftJoin(roles, eq(roles.id, memberRoles.roleId))
		.where(eq(sharedDevTokens.tokenHash, tokenHash));

	if (rows.length === 0 || rows[0].status !== "active") return null;

	const elevatedRoles = normalizeRoleKeys(rows.map((row) => row.role)).filter((role) => role !== "member");

	return {
		memberId: rows[0].memberId,
		roles: ["member", ...new Set(elevatedRoles)],
		context: "shared_dev_token",
		sharedTokenHash: tokenHash,
		sharedTokenLabel: rows[0].label,
	};
}
