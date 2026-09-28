import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { isRosterSignInAllowed, syncSignedInMemberProfile } from "./roster";

describe("isRosterSignInAllowed", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM term_member_roster").run();
		await env.DB.prepare("DELETE FROM member_roles").run();
		await env.DB.prepare("DELETE FROM terms").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("DELETE FROM roles").run();

		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("seed", "seed@example.com", "Seed Admin", "active")
			.run();
	});

	it("allows an email present in the member list", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_invited", "invited@example.com", "Invited Member", "inactive")
			.run();
		const db = drizzle(env.DB, { schema });

		await expect(isRosterSignInAllowed(db, "Invited@Example.com")).resolves.toBe(true);
	});

	it("rejects a new sign-in for an email absent from the member list", async () => {
		const db = drizzle(env.DB, { schema });

		await expect(isRosterSignInAllowed(db, "outsider@example.com")).resolves.toBe(false);
	});

	it("lets the configured bootstrap super admin sign in before a member row exists", async () => {
		const db = drizzle(env.DB, { schema });

		await expect(
			isRosterSignInAllowed(
				db,
				" Bootstrap@Example.com ",
				new Date(),
				"bootstrap@example.com",
			),
		).resolves.toBe(true);
	});

	it("backfills a pre-invited member's Google profile on sign-in", async () => {
		await env.DB.prepare("INSERT INTO members (id, email, status) VALUES (?, ?, ?)")
			.bind("mem_invited", "invited@example.com", "inactive")
			.run();
		const db = drizzle(env.DB, { schema });

		await syncSignedInMemberProfile(db, {
			email: " Invited@Example.com ",
			name: "Invited Member",
			picture: "https://example.com/avatar.png",
		});
		const [member] = await db
			.select({ name: schema.members.name, image: schema.members.image, status: schema.members.status })
			.from(schema.members)
			.where(eq(schema.members.id, "mem_invited"));

		expect(member).toEqual({
			name: "Invited Member",
			image: "https://example.com/avatar.png",
			status: "active",
		});
	});
});
