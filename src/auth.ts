import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/db/client";
import { accounts, memberRoles, members, roles, sessions, termMemberRoster, verificationToken } from "@/db/schema";
import { createAuditRepository } from "@/db/repositories/audit";
import { getAppConfig } from "@/server/env";
import {
	getGoogleProviderOptions,
	getRosterDeniedRedirect,
	isGoogleSignInAllowed,
	splitAuthList,
} from "@/server/auth/access";
import { grantBootstrapSuperRole } from "@/server/auth/bootstrap";
import { claimPendingRoles } from "@/server/auth/pending-roles";
import { normalizeRoleKeys } from "@/server/auth/permissions";
import { isRosterSignInAllowed, syncSignedInMemberProfile } from "@/server/auth/roster";

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
	const config = getAppConfig();
	const db = getDb();
	const allowedDomains = splitAuthList(config.AUTH_ALLOWED_DOMAINS);

	const baseAdapter = DrizzleAdapter(db, {
		usersTable: members,
		accountsTable: accounts,
		sessionsTable: sessions,
		verificationTokensTable: verificationToken,
	});

	// The roster gate (src/server/auth/roster.ts) looks members up by a
	// lowercased email. Google's OIDC email claim is normally already
	// lowercase, but nothing guarantees that, so normalize here too.
	// otherwise a mixed-case claim would create a member row the gate
	// can never find, silently breaking the super-admin bypass and the
	// off-roster deactivation.
	const adapter: typeof baseAdapter = {
		...baseAdapter,
		createUser: (data) => baseAdapter.createUser!({ ...data, email: data.email.toLowerCase() }),
		getUserByEmail: (email) => baseAdapter.getUserByEmail!(email.toLowerCase()),
	};

	return {
		adapter,
		providers: [
			Google(getGoogleProviderOptions(config.AUTH_GOOGLE_ID, config.AUTH_GOOGLE_SECRET)),
		],
		session: { strategy: "database" },
		secret: config.AUTH_SECRET,
		trustHost: true,
		callbacks: {
			async signIn({ account, profile }) {
				const allowed = isGoogleSignInAllowed(
					{
						provider: account?.provider,
						email: profile?.email,
						emailVerified: profile?.email_verified === true,
					},
					{ allowedDomains, bootstrapEmail: config.AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL },
				);
				if (!allowed) return false;
				if (!profile?.email) return false;

				const rosterAllowed = await isRosterSignInAllowed(db, profile.email, new Date(), config.AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL);
				if (rosterAllowed) await syncSignedInMemberProfile(db, profile);
				return rosterAllowed || getRosterDeniedRedirect(profile.email);
			},
			async session({ session, user }) {
				const [member] = await db.select().from(members).where(eq(members.id, user.id)).limit(1);
				if (!member) return session;

				const elevated = await db
					.select()
					.from(memberRoles)
					.innerJoin(roles, eq(roles.id, memberRoles.roleId))
					.where(eq(memberRoles.memberId, user.id));

				session.user.id = user.id;
				session.user.status = member.status;
				session.user.roles = [
					"member",
					...normalizeRoleKeys(elevated.map((item) => item.roles.key)).filter((role) => role !== "member"),
				];
				return session;
			},
		},
		events: {
			async createUser({ user }) {
				if (!user.id) return;
				if (user.email) {
					await grantBootstrapSuperRole(db, user.id, user.email, config.AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL);
				}
				await db.update(members).set({ status: "active", updatedAt: new Date() }).where(eq(members.id, user.id));
				// admins can add a roster row by email before the member ever signs in;
				// backfill the link now so reporting joins find this member.
				let claimedRoles = 0;
				if (user.email) {
					await db
						.update(termMemberRoster)
						.set({ memberId: user.id })
						.where(eq(termMemberRoster.email, user.email.toLowerCase()));
					// Roles an admin granted to this email before the account existed. An invite
					// carries no member id, so the grant waits here until there is one.
					claimedRoles = await claimPendingRoles(db, user.id, user.email);
				}
				const audit = createAuditRepository(db as unknown as Parameters<typeof createAuditRepository>[0]);
				await audit.record(
					{ memberId: user.id, roles: ["member"], context: "session" },
					{
						action: "member:self_provision",
						targetType: "member",
						targetId: user.id,
						category: "member",
					},
				);
				// Recorded separately so a grant made before the account existed is still
				// traceable to the sign-in that applied it.
				if (claimedRoles > 0) {
					await audit.record(
						{ memberId: user.id, roles: ["member"], context: "session" },
						{
							action: "role:claim_pending",
							targetType: "member",
							targetId: user.id,
							detail: `roles=${claimedRoles}`,
							category: "member",
						},
					);
				}
			},
		},
	};
});
