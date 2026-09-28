import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { auditLogs } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { createAuditRepository } from "./audit";
import { createLinksRepository } from "./links";

const owner: Actor = { memberId: "mem_owner", roles: ["member"] };
const other: Actor = { memberId: "mem_other", roles: ["member"] };
const moderator: Actor = { memberId: "mem_mod", roles: ["member", "link"] };
const superAdmin: Actor = { memberId: "mem_other", roles: ["member", "super"] };

function repo() {
	const db = drizzle(env.DB, { schema });
	return createLinksRepository(db, createAuditRepository(db));
}

describe("links repository on D1", () => {
	beforeEach(async () => {
		await env.DB.batch([
			env.DB.prepare("DELETE FROM link_hourly_stats"),
			env.DB.prepare("DELETE FROM link_daily_stats"),
			env.DB.prepare("DELETE FROM short_links"),
			env.DB.prepare("DELETE FROM reserved_slugs"),
			env.DB.prepare("DELETE FROM audit_logs"),
			env.DB.prepare("DELETE FROM members"),
		]);
		await env.DB.batch([
			env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)").bind("mem_owner", "owner@example.com", "Owner"),
			env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)").bind("mem_other", "other@example.com", "Other"),
			env.DB.prepare("INSERT INTO members (id, email, name) VALUES (?, ?, ?)").bind("mem_mod", "mod@example.com", "Mod"),
			env.DB.prepare("INSERT INTO reserved_slugs (slug) VALUES (?)").bind("portal"),
		]);
	});

	it("creates an owned link, normalizes the slug, and audits", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "  /Promo-2026 ", destinationUrl: "https://example.com/x", title: "Promo" });
		expect(link.slug).toBe("promo-2026");
		expect(link.ownerMemberId).toBe("mem_owner");
		const [audit] = await drizzle(env.DB, { schema }).select().from(auditLogs);
		expect(audit).toMatchObject({ action: "link:create", category: "link", targetId: link.id });
	});

	it("rejects a reserved slug, a malformed slug, and a non-http destination", async () => {
		const repository = repo();
		await expect(repository.create(owner, { slug: "portal", destinationUrl: "https://e.com", title: "x" })).rejects.toThrow("reserved");
		await expect(repository.create(owner, { slug: "no", destinationUrl: "https://e.com", title: "x" })).rejects.toThrow("Invalid slug");
		await expect(repository.create(owner, { slug: "good-slug", destinationUrl: "javascript:alert(1)", title: "x" })).rejects.toThrow(
			"destination",
		);
	});

	it("rejects a duplicate slug", async () => {
		const repository = repo();
		await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com", title: "x" });
		await expect(repository.create(other, { slug: "welcome", destinationUrl: "https://e.com", title: "y" })).rejects.toThrow("taken");
	});

	it("forbids a non-owner without moderate from updating or deleting", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com", title: "x" });
		await expect(repository.update(other, link.id, { title: "hijack" })).rejects.toThrow("Not authorized");
		await expect(repository.remove(other, link.id)).rejects.toThrow("Not authorized");
	});

	it("lets a moderator list all links and update any link", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com", title: "x" });
		await expect(repository.update(moderator, link.id, { title: "moderated" })).resolves.toMatchObject({ title: "moderated" });
		const all = await repository.listAll(moderator, { limit: 10 });
		expect(all.map((l) => l.id)).toContain(link.id);
		await expect(repository.listAll(other, { limit: 10 })).rejects.toThrow("Not authorized");
	});

	it("lists visible links with owner data and saved tags", async () => {
		const repository = repo();
		const first = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com", title: "Welcome", tags: ["event", "social"] });
		const second = await repository.create(other, { slug: "newsletter", destinationUrl: "https://e.com/news", title: "News" });

		const visible = await repository.listVisible(owner, { limit: 10 });
		expect(visible.map((link) => link.id).sort()).toEqual([first.id, second.id].sort());
		expect(visible.find((link) => link.id === first.id)).toMatchObject({ tags: ["event", "social"], owner: { id: "mem_owner", name: "Owner" } });
		expect(first.qrStyle.logoUrl).toBe("/code-falcon-transparent.svg");
		expect(first.qrStyle).toMatchObject({ pattern: "classic", cornerStyle: "square", showLogo: true, logoSize: 0.24, showLogoBacking: false });
	});

	it("round-trips tags and qr style on update", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com", title: "x" });
		const updated = await repository.update(owner, link.id, {
			tags: ["crs"],
			qrStyle: { foreground: "#0C315C", background: "#FFFFFF", logoSize: 0.2, logoMargin: 4, logoUrl: "/logo.svg", showLogoBacking: false },
		});

		expect(updated.tags).toEqual(["crs"]);
		expect(updated.qrStyle).toMatchObject({ foreground: "#0C315C", logoUrl: "/logo.svg", showLogoBacking: false });

		const colorOnly = await repository.update(owner, link.id, { qrStyle: { foreground: "#121315" } });
		expect(colorOnly.qrStyle).toMatchObject({ foreground: "#121315", logoUrl: "/logo.svg", logoSize: 0.2, logoMargin: 4 });
	});

	it("hydrates legacy saved QR styles without losing explicit values", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com", title: "x" });
		await drizzle(env.DB, { schema }).update(schema.shortLinks).set({
			qrStyle: JSON.stringify({
				foreground: "#0C315C",
				background: "#FFFFFF",
				logoUrl: "/legacy.svg",
				logoSize: 0.28,
				logoMargin: 6,
				showLogoBacking: true,
			}),
		}).where(eq(schema.shortLinks.id, link.id));

		const [hydrated] = await repository.listVisible(owner, { limit: 10 });
		expect(hydrated.qrStyle).toMatchObject({
			foreground: "#0C315C",
			logoUrl: "/legacy.svg",
			logoSize: 0.28,
			showLogoBacking: true,
			pattern: "classic",
			cornerStyle: "square",
			showLogo: true,
			transparentBackground: false,
		});

		await drizzle(env.DB, { schema }).update(schema.shortLinks).set({
			qrStyle: JSON.stringify({ foreground: "#06192F", background: "#FFFFFF", logoUrl: null }),
		}).where(eq(schema.shortLinks.id, link.id));
		const [withoutLogo] = await repository.listVisible(owner, { limit: 10 });
		expect(withoutLogo.qrStyle).toMatchObject({ logoUrl: null, showLogo: false });
	});

	it("uses link ownership and moderation permission for edit checks", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com", title: "x" });
		await expect(repository.canEditLink(owner, link.id)).resolves.toBe(true);
		await expect(repository.canEditLink(moderator, link.id)).resolves.toBe(true);
		await expect(repository.canEditLink(superAdmin, link.id)).resolves.toBe(true);
		await expect(repository.canEditLink(other, link.id)).resolves.toBe(false);
		await expect(repository.canEditLink(owner, "missing")).resolves.toBe(false);
	});

	it("lets non-owners read link details and stats", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com", title: "x" });
		await repository.recordClick(link.id, { date: "2026-06-19", hour: "2026-06-19T10:00", referrerBucket: "direct", deviceBucket: "desktop" });

		await expect(repository.getById(other, link.id)).resolves.toMatchObject({ id: link.id });
		await expect(repository.getStats(other, link.id)).resolves.toMatchObject({ link: { id: link.id } });
	});

	it("resolves a slug for redirect and records a fail-open click upsert", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com/dest", title: "x" });
		const resolved = await repository.resolveForRedirect("welcome");
		expect(resolved?.destinationUrl).toBe("https://e.com/dest");
		expect(await repository.resolveForRedirect("missing")).toBeNull();

		await repository.recordClick(link.id, { date: "2026-06-19", hour: "2026-06-19T10:00", referrerBucket: "direct", deviceBucket: "desktop" });
		await repository.recordClick(link.id, { date: "2026-06-19", hour: "2026-06-19T10:00", referrerBucket: "direct", deviceBucket: "desktop" });
		const stats = await repository.getStats(owner, link.id, { from: "2026-06-19", to: "2026-06-19" });
		expect(stats.series.find((d) => d.date === "2026-06-19")?.count).toBe(2);
		expect(stats.hourly.find((d) => d.hour === "2026-06-19T10:00+00:00")?.count).toBe(2);
		const [row] = await drizzle(env.DB, { schema }).select().from(schema.shortLinks);
		expect(row.clickCount).toBe(2);
	});

	it("applies timezone, source, and device filters before every analytics result", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com", title: "x" });
		await repository.recordClick(link.id, { date: "2026-06-18", hour: "2026-06-18T23:00", referrerBucket: "direct", deviceBucket: "desktop" });
		await repository.recordClick(link.id, { date: "2026-06-19", hour: "2026-06-19T23:00", referrerBucket: "direct", deviceBucket: "desktop" });
		await repository.recordClick(link.id, { date: "2026-06-20", hour: "2026-06-20T00:00", referrerBucket: "qr scan", deviceBucket: "mobile" });
		await repository.recordClick(link.id, { date: "2026-06-20", hour: "2026-06-20T01:00", referrerBucket: "legacy", deviceBucket: "mobile" });

		const all = await repository.getStats(owner, link.id, {
			from: "2026-06-20",
			to: "2026-06-20",
			timezone: "Asia/Manila",
			granularity: "day",
		});
		expect(all).toMatchObject({
			lifetimeClicks: 4,
			filteredClicks: 3,
			series: [{ date: "2026-06-20", count: 3 }],
			comparison: { from: "2026-06-19", to: "2026-06-19", filteredClicks: 1 },
			query: { timezone: "Asia/Manila", source: "all", device: "all" },
			history: { basis: "hourly", complete: true },
		});
		expect(all.referrers).toEqual([
			{ bucket: "direct", count: 1 },
			{ bucket: "qr scan", count: 1 },
			{ bucket: "unknown", count: 1 },
		]);
		expect(all.devices).toEqual([
			{ bucket: "desktop", count: 1 },
			{ bucket: "mobile", count: 2 },
		]);
		expect(all.referrers.reduce((sum, row) => sum + row.count, 0)).toBe(all.filteredClicks);
		expect(all.devices.reduce((sum, row) => sum + row.count, 0)).toBe(all.filteredClicks);
		const byHour = await repository.getStats(owner, link.id, {
			from: "2026-06-20",
			to: "2026-06-20",
			timezone: "Asia/Manila",
			granularity: "hour",
		});
		expect(byHour.series).toHaveLength(24);
		expect(byHour.series.find((row) => row.date === "2026-06-20T07:00+08:00")?.count).toBe(1);
		expect(byHour.series.find((row) => row.date === "2026-06-20T08:00+08:00")?.count).toBe(1);
		expect(byHour.series.find((row) => row.date === "2026-06-20T09:00+08:00")?.count).toBe(1);

		const qrMobile = await repository.getStats(owner, link.id, {
			from: "2026-06-20",
			to: "2026-06-20",
			timezone: "Asia/Manila",
			source: "qr",
			device: "mobile",
			granularity: "week",
		});
		expect(qrMobile).toMatchObject({
			lifetimeClicks: 4,
			filteredClicks: 1,
			series: [{ date: "2026-06-15", count: 1 }],
			referrers: [{ bucket: "qr scan", count: 1 }],
			devices: [{ bucket: "mobile", count: 1 }],
		});
		const unknown = await repository.getStats(owner, link.id, {
			from: "2026-06-20",
			to: "2026-06-20",
			timezone: "Asia/Manila",
			source: "unknown",
		});
		expect(unknown).toMatchObject({ filteredClicks: 1, referrers: [{ bucket: "unknown", count: 1 }] });

		const zeroFilled = await repository.getStats(owner, link.id, {
			from: "2026-06-19",
			to: "2026-06-21",
			timezone: "Asia/Manila",
			source: "qr",
			granularity: "day",
		});
		expect(zeroFilled.series).toEqual([
			{ date: "2026-06-19", count: 0 },
			{ date: "2026-06-20", count: 1 },
			{ date: "2026-06-21", count: 0 },
		]);
		const monthly = await repository.getStats(owner, link.id, {
			from: "2026-06-20",
			to: "2026-07-01",
			timezone: "Asia/Manila",
			source: "qr",
			granularity: "month",
		});
		expect(monthly.series).toEqual([
			{ date: "2026-06", count: 1 },
			{ date: "2026-07", count: 0 },
		]);
	});

	it("keeps repeated DST hours distinct in hourly analytics", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "fallback", destinationUrl: "https://e.com", title: "Fallback" });
		await repository.recordClick(link.id, { date: "2026-11-01", hour: "2026-11-01T05:00", referrerBucket: "direct", deviceBucket: "desktop" });
		await repository.recordClick(link.id, { date: "2026-11-01", hour: "2026-11-01T06:00", referrerBucket: "direct", deviceBucket: "desktop" });

		const stats = await repository.getStats(owner, link.id, {
			from: "2026-11-01",
			to: "2026-11-01",
			timezone: "America/New_York",
			granularity: "hour",
		});

		expect(stats.series).toHaveLength(25);
		expect(stats.series.filter((row) => row.date.startsWith("2026-11-01T01:00"))).toEqual([
			{ date: "2026-11-01T01:00-04:00", count: 1 },
			{ date: "2026-11-01T01:00-05:00", count: 1 },
		]);
		expect(stats.hourly.filter((row) => row.hour.startsWith("2026-11-01T01:00"))).toEqual([
			{ hour: "2026-11-01T01:00-04:00", count: 1 },
			{ hour: "2026-11-01T01:00-05:00", count: 1 },
		]);
	});

	it("rejects invalid analytics timezones and ranges with narrowing guidance", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com", title: "x" });
		await expect(repository.getStats(owner, link.id, { timezone: "Mars/Olympus" })).rejects.toThrow("IANA timezone");
		await expect(repository.getStats(owner, link.id, { from: "2025-01-01", to: "2026-01-02" })).rejects.toThrow("narrower date range");
		await expect(repository.getStats(owner, link.id, { from: "2026-01-01", to: "2026-01-15", granularity: "hour" })).rejects.toThrow("Hourly analytics are limited");
	});
});
