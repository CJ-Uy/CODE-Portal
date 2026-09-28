import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { grantBootstrapSuperRole } from "./bootstrap";

describe("grantBootstrapSuperRole", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM member_roles").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("DELETE FROM roles").run();
		await env.DB.prepare("INSERT INTO roles (id, key, label, description, kind) VALUES (?, ?, ?, ?, ?)")
			.bind("role_super", "super", "Super admin", "Full access.", "admin")
			.run();
		await env.DB.prepare("INSERT INTO members (id, email, name, status) VALUES (?, ?, ?, ?)")
			.bind("mem_bootstrap", "bootstrap@example.com", "Bootstrap", "active")
			.run();
	});

	it("assigns the super role once to the configured bootstrap email", async () => {
		const db = drizzle(env.DB, { schema });

		await grantBootstrapSuperRole(db, "mem_bootstrap", " Bootstrap@Example.com ", "bootstrap@example.com");
		await grantBootstrapSuperRole(db, "mem_bootstrap", "bootstrap@example.com", "bootstrap@example.com");

		const rows = await db
			.select()
			.from(schema.memberRoles)
			.where(eq(schema.memberRoles.memberId, "mem_bootstrap"));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			memberId: "mem_bootstrap",
			roleId: "role_super",
			assignedBy: "mem_bootstrap",
		});
	});

	it("does nothing for a different email", async () => {
		const db = drizzle(env.DB, { schema });

		await grantBootstrapSuperRole(db, "mem_bootstrap", "member@example.com", "bootstrap@example.com");

		const rows = await db.select().from(schema.memberRoles);
		expect(rows).toHaveLength(0);
	});
});
