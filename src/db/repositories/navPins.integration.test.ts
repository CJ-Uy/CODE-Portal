import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createNavPinsRepository } from "./navPins";

const navAdmin: Actor = { memberId: "mem_nav_admin", roles: ["member", "member_admin"] };
const member: Actor = { memberId: "mem_plain", roles: ["member"] };

describe("nav pins repository on D1", () => {
	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM audit_logs").run();
		await env.DB.prepare("DELETE FROM nav_pins").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)")
			.bind(navAdmin.memberId, "nav@example.com", "Nav Admin")
			.run();
	});

	it("lets a member_admin create, list, update, and remove a pin, auditing writes", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createNavPinsRepository(db, createAuditRepository(db));

		const created = await repository.create(navAdmin, {
			label: "Masterfile",
			url: "https://example.com/masterfile",
			icon: "file-spreadsheet",
			position: 1,
		});
		const updated = await repository.update(navAdmin, created.id, {
			label: "Org Masterfile",
			url: "https://example.com/masterfile",
			icon: "file-spreadsheet",
			position: 2,
		});
		expect(updated).toMatchObject({ label: "Org Masterfile", position: 2 });

		await repository.remove(navAdmin, created.id);
		expect(await repository.list(navAdmin)).toHaveLength(0);

		const audits = await db.select().from(auditLogs);
		expect(audits.map((row) => row.action)).toEqual(
			expect.arrayContaining(["nav_pin:create", "nav_pin:update", "nav_pin:delete"]),
		);
	});

	it("rejects a plain member from listing or mutating pins", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createNavPinsRepository(db, createAuditRepository(db));

		await expect(repository.list(member)).rejects.toThrow("Not authorized");
		await expect(
			repository.create(member, { label: "x", url: "https://x.test", icon: "link", position: 1 }),
		).rejects.toThrow("Not authorized");
	});

	it("lets a signed-in member read visible pins", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createNavPinsRepository(db, createAuditRepository(db));
		await repository.create(navAdmin, { label: "A", url: "https://a.test", icon: "Link2", position: 1 });

		await expect(repository.listVisible(member)).resolves.toMatchObject([{ label: "A" }]);
	});

	it("returns pins ordered by ascending position", async () => {
		const db = drizzle(env.DB, { schema });
		const repository = createNavPinsRepository(db, createAuditRepository(db));
		await repository.create(navAdmin, { label: "B", url: "https://b.test", icon: "link", position: 2 });
		await repository.create(navAdmin, { label: "A", url: "https://a.test", icon: "link", position: 1 });

		const listed = await repository.list(navAdmin);
		expect(listed.map((pin) => pin.label)).toEqual(["A", "B"]);
	});
});
