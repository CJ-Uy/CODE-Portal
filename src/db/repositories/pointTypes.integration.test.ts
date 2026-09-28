import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { RETENTION_POINT_TYPE_ID } from "@/lib/point-types";
import type { Actor } from "@/server/auth/permissions";
import { createPointTypesRepository } from "./pointTypes";

const retentionAdmin: Actor = { memberId: "mem_admin", roles: ["retention"] };
const plainMember: Actor = { memberId: "mem_plain", roles: [] };
const audit = { record: async () => undefined, list: async () => [] };

describe("point types repository", () => {
	const db = drizzle(env.DB, { schema });
	const repo = createPointTypesRepository(db, audit);

	beforeEach(async () => {
		await env.DB.prepare("DELETE FROM event_point_awards").run();
		await env.DB.prepare("DELETE FROM point_types").run();
		await env.DB.prepare("DELETE FROM members").run();
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
			.bind("mem_admin", "admin@example.com", "Admin", Date.now(), Date.now()).run();
		await env.DB.prepare("INSERT INTO members (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
			.bind("mem_plain", "plain@example.com", "Plain", Date.now(), Date.now()).run();
		await env.DB.prepare(
			"INSERT INTO point_types (id, key, label, active, position) VALUES (?, ?, ?, ?, ?)",
		).bind("pt_retention", "retention", "Retention", 1, 1).run();
		await env.DB.prepare(
			"INSERT INTO point_types (id, key, label, active, position) VALUES (?, ?, ?, ?, ?)",
		).bind("pt_frontliner", "frontliner", "Frontliner", 0, 2).run();
	});

	it("lists active and inactive rows in display order", async () => {
		expect((await repo.list()).map((row) => [row.id, row.active])).toEqual([
			["pt_retention", true],
			["pt_frontliner", false],
		]);
	});

	it("reads milestones saved by the first milestone editor", async () => {
		await env.DB.prepare("UPDATE point_types SET milestones_json = ? WHERE id = ?")
			.bind(JSON.stringify([{ points: 10, label: "Automatic renewal" }]), "pt_frontliner")
			.run();
		expect((await repo.list()).find((row) => row.id === "pt_frontliner")?.milestones).toEqual([
			{ points: 10, title: "Automatic renewal", description: "" },
		]);
	});

	it("creates a type with a derived immutable id", async () => {
		await expect(repo.upsertType(retentionAdmin, {
			id: null,
			key: "project_lead",
			label: "Project Lead",
			milestones: [{ points: 10, title: "Eligible to lead a project", description: "Lead next term" }],
			active: true,
			position: 3,
		})).resolves.toMatchObject({
			id: "pt_project_lead",
			key: "project_lead",
			milestones: [{ points: 10, title: "Eligible to lead a project", description: "Lead next term" }],
		});
	});

	it("requires retention configuration permission and keeps keys immutable", async () => {
		await expect(repo.upsertType(plainMember, {
			id: "pt_frontliner",
			key: "frontliner",
			label: "Frontliner",
			active: true,
			position: 2,
		})).rejects.toThrow("Not authorized");
		await expect(repo.upsertType(retentionAdmin, {
			id: "pt_frontliner",
			key: "renamed",
			label: "Frontliner",
			active: true,
			position: 2,
		})).rejects.toThrow("Point type keys cannot be changed.");
	});

	it("validates write values inside the repository", async () => {
		await expect(repo.upsertType(retentionAdmin, {
			id: null,
			key: "Bad Key",
			label: " ",
			active: true,
			position: 1.5,
		})).rejects.toThrow();
	});

	it("refuses to retire the retention point type", async () => {
		await expect(
			repo.upsertType(retentionAdmin, {
				id: RETENTION_POINT_TYPE_ID,
				key: "retention",
				label: "Retention",
				active: false,
				position: 0,
			}),
		).rejects.toThrow("The Retention point type cannot be retired.");
	});

	it("allows relabelling and reordering the retention point type", async () => {
		const row = await repo.upsertType(retentionAdmin, {
			id: RETENTION_POINT_TYPE_ID,
			key: "retention",
			label: "CRS Retention",
			active: true,
			position: 3,
		});
		expect(row.label).toBe("CRS Retention");
		expect(row.position).toBe(3);
	});
});
