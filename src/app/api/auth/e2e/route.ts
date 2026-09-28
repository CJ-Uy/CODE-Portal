import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { crsEvents, memberRoles, members, roles, seedEventTypes, sessions, terms } from "@/db/schema";

const SEEDED = {
	"admin@example.com": { id: "mem_demo_admin", name: "Demo Admin", role: "super" },
	"member@example.com": { id: "mem_demo_member", name: "Demo Member", role: null },
} as const;

export async function POST(request: Request): Promise<Response> {
	if (process.env.APP_ENV !== "local" || process.env.E2E_AUTH_BYPASS !== "1") {
		return new Response("Not found", { status: 404 });
	}

	const { email } = (await request.json()) as { email?: string };
	if (!email) return new Response("email required", { status: 400 });

	const db = getDb();
	await ensureE2eData(db);
	let [member] = await db.select().from(members).where(eq(members.email, email)).limit(1);
	if (!member && email in SEEDED) {
		const seeded = SEEDED[email as keyof typeof SEEDED];
		// ponytail: local E2E self-seeds only auth actors when the sandbox blocks db:seed:local.
		await db
			.insert(members)
			.values({ id: seeded.id, email, name: seeded.name, fullName: seeded.name, status: "active" })
			.onConflictDoNothing();
		if (seeded.role) {
			await db
				.insert(roles)
				.values({ id: "role_super", key: "super", label: "Super admin", description: "Full portal access.", kind: "admin" })
				.onConflictDoNothing();
			await db
				.insert(memberRoles)
				.values({ memberId: seeded.id, roleId: "role_super", assignedBy: seeded.id })
				.onConflictDoNothing();
		}
		[member] = await db.select().from(members).where(eq(members.email, email)).limit(1);
	}
	if (!member) return new Response("seeded member not found", { status: 404 });

	const token = `e2e-${crypto.randomUUID()}`;
	const expires = new Date(Date.now() + 1000 * 60 * 60);
	await db.insert(sessions).values({ sessionToken: token, userId: member.id, expires });

	const headers = new Headers({ "content-type": "application/json" });
	headers.append("set-cookie", `authjs.session-token=${token}; Path=/; HttpOnly; SameSite=Lax`);
	return new Response(JSON.stringify({ ok: true }), { headers });
}

async function ensureE2eData(db: ReturnType<typeof getDb>): Promise<void> {
	const now = new Date("2026-06-18T00:00:00.000Z");
	await db
		.insert(roles)
		.values({ id: "role_super", key: "super", label: "Super admin", description: "Full portal access.", kind: "admin" })
		.onConflictDoNothing();
	await db
		.insert(members)
		.values([
			{ id: "mem_demo_admin", email: "admin@example.com", name: "Demo Admin", fullName: "Demo Admin", status: "active" },
			{ id: "mem_demo_member", email: "member@example.com", name: "Demo Member", fullName: "Demo Member", status: "active" },
		])
		.onConflictDoNothing();
	await db
		.insert(memberRoles)
		.values({ memberId: "mem_demo_admin", roleId: "role_super", assignedBy: "mem_demo_admin" })
		.onConflictDoNothing();
	await db
		.insert(terms)
		.values({
			id: "term_2026_1",
			name: "Term 1 2026",
			retainedAt: 20,
			probationBelow: 10,
			startsAt: now,
			endsAt: new Date("2026-10-31T00:00:00.000Z"),
		})
		.onConflictDoNothing();
	await db
		.insert(crsEvents)
		.values({
			id: "evt_demo",
			title: "Consulting Practice Night",
			type: seedEventTypes[0],
			status: "approved",
			points: 5,
			place: "SOM 111",
			startsAt: new Date("2026-07-10T10:00:00.000Z"),
			endsAt: new Date("2026-07-10T12:00:00.000Z"),
			description: "A sample CRS event for portal modules.",
			createdBy: "mem_demo_admin",
			approvedBy: "mem_demo_admin",
			approvedAt: now,
			checkinSecret: "demo-checkin-secret",
		})
		.onConflictDoNothing();
}
