# Phase 3 — Short Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full short-link subsystem — owner-scoped CRUD with slug/destination validation, the public `/l/[slug]` redirect with fail-open daily-stat rollups, owner-controlled embed/OG preview cards served to crawler user-agents, an analytics view, client-side QR export, and an admin moderation queue — on top of the v5 schema tables (`short_links`, `link_daily_stats`, `reserved_slugs`) that already exist.

**Architecture:** All query logic lives in a single `createLinksRepository(db, audit)` repository module that takes an explicit `actor` and calls `permissions.can()` before privileged reads/writes and `audit.record()` after privileged writes, exactly like `createMembersRepository`. A Zod `linksContract` (built with the existing `operation()` helper) types every operation; cookie-authenticated same-origin `/api/links*` route handlers and the cross-origin bearer-guarded `/internal/links*` handlers are both driven from that contract, so logic stays DRY across `local` / `production` / `shared` access modes. Validation (slug format, reserved slugs, http/https destination, crawler-UA detection) lives in pure modules under `src/lib/` so it is unit-tested in isolation. The `/l/[slug]` system route resolves and 302s immediately, then records analytics through `runInBackground()` after responding; a crawler-UA branch returns an OG-meta HTML page instead of the 302.

**Tech Stack:** Next.js 16 App Router on Cloudflare Workers (OpenNext), Drizzle ORM (SQLite dialect, D1), Zod, Vitest + `@cloudflare/vitest-pool-workers` (the existing `vitest.config.mts` auto-applies `drizzle/migrations` to an ephemeral test D1), Tailwind CSS v4 + the local shadcn/ui registry (`src/components/ui`), lucide-react.

## Global Constraints

- Drizzle schema at `src/db/schema.ts` is the ONE source of truth; one migration set under `drizzle/migrations`. Phase 3 adds NO new tables or columns — `short_links` (with `preview_title`/`preview_description`/`preview_image_key`), `link_daily_stats`, and `reserved_slugs` already exist from the v5 migration.
- Do not expose D1 as `DATABASE_URL`. Do not add raw SQL internal endpoints. (CLAUDE.md)
- Only adapter/internal code may touch raw bindings; feature code uses repositories. System routes (`/l/[slug]`) may use `runInBackground()` from `src/server/cloudflare.ts` but otherwise must not touch bindings. (master plan Global Constraints / §6)
- Every repository function takes an explicit `actor` and calls `can()` before privileged reads/writes and `audit.record()` after privileged writes; authorization holds identically across access modes. (§3.2, §5)
- Mutating `/api/*` handlers call `assertSameOrigin(request, config.APP_BASE_URL)` and proxy to the dev Worker when `APP_ENV==='shared'`. `/internal/*` handlers are cross-origin: bearer token → seeded actor, 404 unless `DEPLOY_ENV==='dev'`, CORS allowlist, no cookie auth. (§3.3, §4.5)
- Per-operation contract declares `auth`/`permission`/`sharedDev`; destructive/admin ops default `sharedDev: 'deny'`. (§3.3)
- D1 budget: ≤100 bound params / ≤100 KB per statement; no unbounded `SELECT` (paginate with limit/offset, default 25, max 50); every query has a backing index (`short_links_slug_idx`, `short_links_owner_member_id_idx`, `link_daily_stats_link_date_idx` already exist). (§3.4)
- `destination_url` is validated http/https only (open-redirect guard). Slugs are stored WITHOUT a leading slash; `/l/` is purely a routing prefix. (§1, §6)
- Analytics is fail-open: the `/l/[slug]` redirect must never block or fail on the stat write. The crawler-UA branch must not affect that guarantee. (§6)
- The link preview image is the only PUBLIC upload namespace (`links/{linkId}/preview`), because it is served to crawlers; all other upload GETs stay auth-gated. (§7)
- `link:moderate` (admin) and `member` (owner) are the only permission scopes Phase 3 needs; both already exist in `src/server/auth/permissions.ts`. No new permission actions.
- UI is built from the local shadcn/ui registry (`src/components/ui`: `button`, `card`, `input`, `textarea`, `select`, `tabs`, `badge`, `checkbox` already present) themed via `src/app/globals.css` tokens; add others with `pnpm dlx shadcn@latest add <component>`. Tailwind v4 utilities only; no CSS-in-JS. No em dashes in UI copy, code comments, docs, or commits.
- After schema/contract/permissions/internal-route changes land, the dev Worker must be redeployed (`pnpm db:migrate:dev` then `pnpm deploy:dev`) per CLAUDE.md and master-plan §15 — surfaced as a gated final step. Phase 3 changes the contract and adds `/internal/links`, so the redeploy obligation applies even though no schema change occurs.
- Show the exact `pnpm exec wrangler` / `pnpm db:*` / `pnpm deploy:*` command and wait for approval before any D1, seed, or dev-Worker-touching operation. (CLAUDE.md)

---

### Task 1: Slug, destination, and referrer/device validation helpers (pure)

**Files:**
- Create: `src/lib/links.ts`
- Create: `src/lib/links.test.ts`

**Interfaces:**
- Produces:
  - `normalizeSlug(raw: string): string` — trims, lowercases, strips a single leading `/`.
  - `isValidSlugFormat(slug: string): boolean` — 3-32 chars, `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$` (lowercase alnum + internal hyphens, no leading/trailing/double hyphen).
  - `isValidDestinationUrl(url: string): boolean` — parses; true only for `http:`/`https:` protocol.
  - `RESERVED_SLUG_DEFAULTS: readonly string[]` — `["portal", "admin", "api", "l", "signin", "internal"]` (route names slugs must never shadow).
  - `referrerBucket(referer: string | null): string` — `"direct"` when null/empty, else the lowercased hostname, else `"other"` when unparseable.
  - `deviceBucket(userAgent: string | null): "mobile" | "desktop"` — `"mobile"` if UA matches `/Mobi|Android|iPhone|iPad|iPod/i`, else `"desktop"`.
  - Tasks 3 (repository), 4 (contract input schema), and 6 (`/l/[slug]` route) consume these exact names and signatures.

- [ ] **Step 1: Write the failing test**

Create `src/lib/links.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
	deviceBucket,
	isValidDestinationUrl,
	isValidSlugFormat,
	normalizeSlug,
	referrerBucket,
	RESERVED_SLUG_DEFAULTS,
} from "./links";

describe("normalizeSlug", () => {
	it("trims, lowercases, and strips one leading slash", () => {
		expect(normalizeSlug("  /YHK  ")).toBe("yhk");
		expect(normalizeSlug("Promo-2026")).toBe("promo-2026");
	});
});

describe("isValidSlugFormat", () => {
	it("accepts lowercase alphanumeric slugs with internal hyphens", () => {
		expect(isValidSlugFormat("welcome")).toBe(true);
		expect(isValidSlugFormat("promo-2026")).toBe(true);
	});
	it("rejects too-short, too-long, edge-hyphen, and illegal-character slugs", () => {
		expect(isValidSlugFormat("ab")).toBe(false);
		expect(isValidSlugFormat("a".repeat(33))).toBe(false);
		expect(isValidSlugFormat("-lead")).toBe(false);
		expect(isValidSlugFormat("trail-")).toBe(false);
		expect(isValidSlugFormat("double--hyphen")).toBe(false);
		expect(isValidSlugFormat("UPPER")).toBe(false);
		expect(isValidSlugFormat("has space")).toBe(false);
	});
});

describe("isValidDestinationUrl", () => {
	it("accepts http and https", () => {
		expect(isValidDestinationUrl("https://example.com/x")).toBe(true);
		expect(isValidDestinationUrl("http://example.com")).toBe(true);
	});
	it("rejects other protocols and garbage (open-redirect guard)", () => {
		expect(isValidDestinationUrl("javascript:alert(1)")).toBe(false);
		expect(isValidDestinationUrl("ftp://example.com")).toBe(false);
		expect(isValidDestinationUrl("data:text/html,x")).toBe(false);
		expect(isValidDestinationUrl("not a url")).toBe(false);
	});
});

describe("RESERVED_SLUG_DEFAULTS", () => {
	it("includes the route names slugs must not shadow", () => {
		expect(RESERVED_SLUG_DEFAULTS).toContain("portal");
		expect(RESERVED_SLUG_DEFAULTS).toContain("l");
		expect(RESERVED_SLUG_DEFAULTS).toContain("api");
	});
});

describe("referrerBucket", () => {
	it("buckets null to direct and a URL to its hostname", () => {
		expect(referrerBucket(null)).toBe("direct");
		expect(referrerBucket("")).toBe("direct");
		expect(referrerBucket("https://www.Google.com/search?q=x")).toBe("www.google.com");
		expect(referrerBucket("garbage")).toBe("other");
	});
});

describe("deviceBucket", () => {
	it("classifies mobile and desktop user-agents", () => {
		expect(deviceBucket("Mozilla/5.0 (iPhone; CPU iPhone OS)")).toBe("mobile");
		expect(deviceBucket("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
		expect(deviceBucket(null)).toBe("desktop");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- links.test.ts`
Expected: FAIL — `./links` does not exist yet.

- [ ] **Step 3: Write `src/lib/links.ts`**

```ts
export const RESERVED_SLUG_DEFAULTS = ["portal", "admin", "api", "l", "signin", "internal"] as const;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const MOBILE_PATTERN = /Mobi|Android|iPhone|iPad|iPod/i;

export function normalizeSlug(raw: string): string {
	return raw.trim().toLowerCase().replace(/^\//, "");
}

export function isValidSlugFormat(slug: string): boolean {
	if (slug.length < 3 || slug.length > 32) return false;
	if (slug.includes("--")) return false;
	return SLUG_PATTERN.test(slug);
}

export function isValidDestinationUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export function referrerBucket(referer: string | null): string {
	if (!referer) return "direct";
	try {
		return new URL(referer).hostname.toLowerCase();
	} catch {
		return "other";
	}
}

export function deviceBucket(userAgent: string | null): "mobile" | "desktop" {
	if (!userAgent) return "desktop";
	return MOBILE_PATTERN.test(userAgent) ? "mobile" : "desktop";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- links.test.ts`
Expected: PASS (all groups green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/links.ts src/lib/links.test.ts
git commit -m "feat(links): add slug, destination, and analytics-bucket validation helpers"
```

---

### Task 2: Crawler user-agent allowlist + OG preview HTML (pure)

**Files:**
- Create: `src/lib/crawlers.ts`
- Create: `src/lib/crawlers.test.ts`

**Interfaces:**
- Produces:
  - `isCrawlerUserAgent(userAgent: string | null): boolean` — true when the UA matches a maintained allowlist (`facebookexternalhit`, `Twitterbot`, `Slackbot`, `Discordbot`, `WhatsApp`, `TelegramBot`, `LinkedInBot`, `Pinterest`, `redditbot`, `Googlebot`, `bingbot`, `Embedly`, `SkypeUriPreview`, case-insensitive).
  - `renderPreviewHtml(input: { title: string; description: string | null; imageUrl: string | null; destinationUrl: string }): string` — a minimal, escaped HTML document with `og:title` / `og:description` / `og:image` / `og:url` / `twitter:card` meta tags and a `<meta http-equiv="refresh">` fallback to the destination so a human who somehow hits the crawler branch still lands on the target.
  - Task 6 (`/l/[slug]` route) consumes both.

- [ ] **Step 1: Write the failing test**

Create `src/lib/crawlers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isCrawlerUserAgent, renderPreviewHtml } from "./crawlers";

describe("isCrawlerUserAgent", () => {
	it("detects common social and search crawlers", () => {
		expect(isCrawlerUserAgent("facebookexternalhit/1.1")).toBe(true);
		expect(isCrawlerUserAgent("Slackbot-LinkExpanding 1.0")).toBe(true);
		expect(isCrawlerUserAgent("Mozilla/5.0 ... Discordbot/2.0")).toBe(true);
		expect(isCrawlerUserAgent("TwitterBot")).toBe(true);
	});
	it("treats real browsers and null as non-crawlers", () => {
		expect(isCrawlerUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120")).toBe(false);
		expect(isCrawlerUserAgent(null)).toBe(false);
	});
});

describe("renderPreviewHtml", () => {
	it("emits escaped OG meta tags and a refresh fallback", () => {
		const html = renderPreviewHtml({
			title: 'A "great" link',
			description: "Body & more",
			imageUrl: "https://cdn.example/img.png",
			destinationUrl: "https://example.com/dest",
		});
		expect(html).toContain('<meta property="og:title" content="A &quot;great&quot; link">');
		expect(html).toContain('<meta property="og:description" content="Body &amp; more">');
		expect(html).toContain('<meta property="og:image" content="https://cdn.example/img.png">');
		expect(html).toContain('content="0;url=https://example.com/dest"');
		expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
	});
	it("omits image and description tags when they are null", () => {
		const html = renderPreviewHtml({
			title: "Title only",
			description: null,
			imageUrl: null,
			destinationUrl: "https://example.com",
		});
		expect(html).not.toContain("og:image");
		expect(html).not.toContain("og:description");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- crawlers.test.ts`
Expected: FAIL — `./crawlers` does not exist yet.

- [ ] **Step 3: Write `src/lib/crawlers.ts`**

```ts
const CRAWLER_PATTERN =
	/facebookexternalhit|Twitterbot|Slackbot|Discordbot|WhatsApp|TelegramBot|LinkedInBot|Pinterest|redditbot|Googlebot|bingbot|Embedly|SkypeUriPreview/i;

export function isCrawlerUserAgent(userAgent: string | null): boolean {
	if (!userAgent) return false;
	return CRAWLER_PATTERN.test(userAgent);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function renderPreviewHtml(input: {
	title: string;
	description: string | null;
	imageUrl: string | null;
	destinationUrl: string;
}): string {
	const title = escapeHtml(input.title);
	const url = escapeHtml(input.destinationUrl);
	const tags = [
		`<meta charset="utf-8">`,
		`<title>${title}</title>`,
		`<meta property="og:title" content="${title}">`,
		`<meta property="og:url" content="${url}">`,
		`<meta property="og:type" content="website">`,
		`<meta name="twitter:card" content="summary_large_image">`,
		`<meta http-equiv="refresh" content="0;url=${url}">`,
	];
	if (input.description) {
		tags.push(`<meta property="og:description" content="${escapeHtml(input.description)}">`);
		tags.push(`<meta name="twitter:description" content="${escapeHtml(input.description)}">`);
	}
	if (input.imageUrl) {
		tags.push(`<meta property="og:image" content="${escapeHtml(input.imageUrl)}">`);
		tags.push(`<meta name="twitter:image" content="${escapeHtml(input.imageUrl)}">`);
	}
	return `<!doctype html><html><head>${tags.join("")}</head><body><a href="${url}">Continue</a></body></html>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- crawlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crawlers.ts src/lib/crawlers.test.ts
git commit -m "feat(links): add crawler-UA allowlist and OG preview HTML renderer"
```

---

### Task 3: Links repository — CRUD + ownership + analytics, with audit

**Files:**
- Modify: `src/db/repositories/links.ts` (replace the whole stub file)
- Create: `src/db/repositories/links.integration.test.ts`

**Interfaces:**
- Consumes: `shortLinks`, `reservedSlugs`, `linkDailyStats` from `@/db/schema`; `Actor`/`can` from `@/server/auth/permissions`; `AuditRepository` from `./audit`; `createId` from `@/lib/ids`; `normalizeSlug`/`isValidSlugFormat`/`isValidDestinationUrl`/`RESERVED_SLUG_DEFAULTS` from `@/lib/links`.
- Produces:
  - `type ShortLink = InferSelectModel<typeof shortLinks>`.
  - `type CreateLinkInput = { slug: string; destinationUrl: string; title: string }`.
  - `type UpdateLinkInput = Partial<{ destinationUrl: string; title: string; previewTitle: string | null; previewDescription: string | null; previewImageKey: string | null }>`.
  - `type ResolvedLink = { id: string; slug: string; destinationUrl: string; title: string; previewTitle: string | null; previewDescription: string | null; previewImageKey: string | null }`.
  - `type LinkStats = { link: ShortLink; series: Array<{ date: string; count: number }>; referrers: Array<{ bucket: string; count: number }>; devices: Array<{ bucket: string; count: number }> }`.
  - `type LinksRepository` with:
    - `listOwn(actor, input?: { limit?: number; offset?: number }): Promise<ShortLink[]>`
    - `listAll(actor, input?: { limit?: number; offset?: number }): Promise<ShortLink[]>` (requires `link:moderate`)
    - `getById(actor, id): Promise<ShortLink | null>` (owner or `link:moderate`)
    - `create(actor, input: CreateLinkInput): Promise<ShortLink>`
    - `update(actor, id, input: UpdateLinkInput): Promise<ShortLink>` (owner or `link:moderate`)
    - `remove(actor, id): Promise<void>` (owner or `link:moderate`)
    - `getStats(actor, id): Promise<LinkStats>` (owner or `link:moderate`)
    - `resolveForRedirect(slug): Promise<ResolvedLink | null>` (NO actor — public path)
    - `recordClick(linkId, input: { date: string; referrerBucket: string; deviceBucket: string }): Promise<void>` (NO actor — background analytics path)
  - `createLinksRepository(db: LinkDb, audit: AuditRepository): LinksRepository`.
  - Tasks 4 (contract), 5 (`/api/links`), 6 (`/l/[slug]`), 7 (`/internal/links`) consume these.

- [ ] **Step 1: Write the failing integration test**

Create `src/db/repositories/links.integration.test.ts`:
```ts
import { env } from "cloudflare:test";
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

function repo() {
	const db = drizzle(env.DB, { schema });
	return createLinksRepository(db, createAuditRepository(db));
}

describe("links repository on D1", () => {
	beforeEach(async () => {
		await env.DB.batch([
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
		await expect(repository.create(owner, { slug: "good-slug", destinationUrl: "javascript:alert(1)", title: "x" })).rejects.toThrow("destination");
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

	it("resolves a slug for redirect and records a fail-open click upsert", async () => {
		const repository = repo();
		const link = await repository.create(owner, { slug: "welcome", destinationUrl: "https://e.com/dest", title: "x" });
		const resolved = await repository.resolveForRedirect("welcome");
		expect(resolved?.destinationUrl).toBe("https://e.com/dest");
		expect(await repository.resolveForRedirect("missing")).toBeNull();

		await repository.recordClick(link.id, { date: "2026-06-19", referrerBucket: "direct", deviceBucket: "desktop" });
		await repository.recordClick(link.id, { date: "2026-06-19", referrerBucket: "direct", deviceBucket: "desktop" });
		const stats = await repository.getStats(owner, link.id);
		expect(stats.series.find((d) => d.date === "2026-06-19")?.count).toBe(2);
		const [row] = await drizzle(env.DB, { schema }).select().from(schema.shortLinks);
		expect(row.clickCount).toBe(2);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- links.integration.test.ts`
Expected: FAIL — `createLinksRepository` is still the empty stub (`Record<string, never>`), so `.create` etc. are undefined.

- [ ] **Step 3: Replace `src/db/repositories/links.ts` in full**

```ts
import { and, desc, eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { createId } from "@/lib/ids";
import { isValidDestinationUrl, isValidSlugFormat, normalizeSlug } from "@/lib/links";
import { linkDailyStats, reservedSlugs, shortLinks } from "@/db/schema";
import type { Actor } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";
import { pageLimit } from "./types";

export type ShortLink = InferSelectModel<typeof shortLinks>;

export type CreateLinkInput = { slug: string; destinationUrl: string; title: string };
export type UpdateLinkInput = Partial<{
	destinationUrl: string;
	title: string;
	previewTitle: string | null;
	previewDescription: string | null;
	previewImageKey: string | null;
}>;
export type ResolvedLink = {
	id: string;
	slug: string;
	destinationUrl: string;
	title: string;
	previewTitle: string | null;
	previewDescription: string | null;
	previewImageKey: string | null;
};
export type LinkStats = {
	link: ShortLink;
	series: Array<{ date: string; count: number }>;
	referrers: Array<{ bucket: string; count: number }>;
	devices: Array<{ bucket: string; count: number }>;
};

export type LinksRepository = {
	listOwn(actor: Actor, input?: { limit?: number; offset?: number }): Promise<ShortLink[]>;
	listAll(actor: Actor, input?: { limit?: number; offset?: number }): Promise<ShortLink[]>;
	getById(actor: Actor, id: string): Promise<ShortLink | null>;
	create(actor: Actor, input: CreateLinkInput): Promise<ShortLink>;
	update(actor: Actor, id: string, input: UpdateLinkInput): Promise<ShortLink>;
	remove(actor: Actor, id: string): Promise<void>;
	getStats(actor: Actor, id: string): Promise<LinkStats>;
	resolveForRedirect(slug: string): Promise<ResolvedLink | null>;
	recordClick(linkId: string, input: { date: string; referrerBucket: string; deviceBucket: string }): Promise<void>;
};

// Structural type for the Drizzle handle; mirrors MemberDb's pattern but kept loose so both the
// better-sqlite3 and D1 drivers satisfy it.
export type LinkDb = {
	select: (...args: unknown[]) => any;
	insert: (table: unknown) => any;
	update: (table: unknown) => any;
	delete: (table: unknown) => any;
};

async function loadOwned(db: LinkDb, actor: Actor, id: string): Promise<ShortLink> {
	const [link] = (await db.select().from(shortLinks).where(eq(shortLinks.id, id)).limit(1)) as ShortLink[];
	if (!link) throw new Error("Link not found.");
	if (link.ownerMemberId !== actor.memberId && !can(actor, "link:moderate")) {
		throw new Error("Not authorized to access this link.");
	}
	return link;
}

export function createLinksRepository(db: LinkDb, audit: AuditRepository): LinksRepository {
	return {
		async listOwn(actor, input) {
			return db
				.select()
				.from(shortLinks)
				.where(eq(shortLinks.ownerMemberId, actor.memberId))
				.orderBy(desc(shortLinks.createdAt))
				.limit(pageLimit(input?.limit))
				.offset(input?.offset ?? 0);
		},
		async listAll(actor, input) {
			if (!can(actor, "link:moderate")) throw new Error("Not authorized to list all links.");
			return db
				.select()
				.from(shortLinks)
				.orderBy(desc(shortLinks.createdAt))
				.limit(pageLimit(input?.limit))
				.offset(input?.offset ?? 0);
		},
		async getById(actor, id) {
			const [link] = (await db.select().from(shortLinks).where(eq(shortLinks.id, id)).limit(1)) as ShortLink[];
			if (!link) return null;
			if (link.ownerMemberId !== actor.memberId && !can(actor, "link:moderate")) {
				throw new Error("Not authorized to read this link.");
			}
			return link;
		},
		async create(actor, input) {
			const slug = normalizeSlug(input.slug);
			if (!isValidSlugFormat(slug)) throw new Error("Invalid slug format.");
			if (!isValidDestinationUrl(input.destinationUrl)) throw new Error("Invalid destination URL.");
			const title = input.title.trim();
			if (!title) throw new Error("A link title is required.");

			const [reserved] = (await db.select().from(reservedSlugs).where(eq(reservedSlugs.slug, slug)).limit(1)) as Array<{ slug: string }>;
			if (reserved) throw new Error("That slug is reserved.");
			const [existing] = (await db.select().from(shortLinks).where(eq(shortLinks.slug, slug)).limit(1)) as ShortLink[];
			if (existing) throw new Error("That slug is already taken.");

			const [link] = (await db
				.insert(shortLinks)
				.values({ id: createId("lnk"), slug, destinationUrl: input.destinationUrl, title, ownerMemberId: actor.memberId })
				.returning()) as ShortLink[];
			await audit.record(actor, { action: "link:create", targetType: "link", targetId: link.id, category: "link" });
			return link;
		},
		async update(actor, id, input) {
			const current = await loadOwned(db, actor, id);
			const patch: Partial<ShortLink> = { updatedAt: new Date() };
			if (input.destinationUrl !== undefined) {
				if (!isValidDestinationUrl(input.destinationUrl)) throw new Error("Invalid destination URL.");
				patch.destinationUrl = input.destinationUrl;
			}
			if (input.title !== undefined) {
				const title = input.title.trim();
				if (!title) throw new Error("A link title is required.");
				patch.title = title;
			}
			if (input.previewTitle !== undefined) patch.previewTitle = input.previewTitle;
			if (input.previewDescription !== undefined) patch.previewDescription = input.previewDescription;
			if (input.previewImageKey !== undefined) patch.previewImageKey = input.previewImageKey;

			const [link] = (await db.update(shortLinks).set(patch).where(eq(shortLinks.id, current.id)).returning()) as ShortLink[];
			const moderated = current.ownerMemberId !== actor.memberId;
			await audit.record(actor, {
				action: moderated ? "link:moderate_update" : "link:update",
				targetType: "link",
				targetId: link.id,
				category: "link",
			});
			return link;
		},
		async remove(actor, id) {
			const current = await loadOwned(db, actor, id);
			await db.delete(shortLinks).where(eq(shortLinks.id, current.id));
			const moderated = current.ownerMemberId !== actor.memberId;
			await audit.record(actor, {
				action: moderated ? "link:moderate_delete" : "link:delete",
				targetType: "link",
				targetId: current.id,
				category: "link",
			});
		},
		async getStats(actor, id) {
			const link = await loadOwned(db, actor, id);
			const rows = (await db
				.select()
				.from(linkDailyStats)
				.where(eq(linkDailyStats.linkId, link.id))
				.limit(2000)) as Array<{ date: string; referrerBucket: string; deviceBucket: string; count: number }>;
			const byDate = new Map<string, number>();
			const byReferrer = new Map<string, number>();
			const byDevice = new Map<string, number>();
			for (const row of rows) {
				byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.count);
				byReferrer.set(row.referrerBucket, (byReferrer.get(row.referrerBucket) ?? 0) + row.count);
				byDevice.set(row.deviceBucket, (byDevice.get(row.deviceBucket) ?? 0) + row.count);
			}
			const toSorted = (map: Map<string, number>) =>
				Array.from(map.entries())
					.map(([key, count]) => ({ key, count }))
					.sort((a, b) => (a.key < b.key ? -1 : 1));
			return {
				link,
				series: toSorted(byDate).map(({ key, count }) => ({ date: key, count })),
				referrers: toSorted(byReferrer).map(({ key, count }) => ({ bucket: key, count })),
				devices: toSorted(byDevice).map(({ key, count }) => ({ bucket: key, count })),
			};
		},
		async resolveForRedirect(slug) {
			const normalized = normalizeSlug(slug);
			const [link] = (await db
				.select({
					id: shortLinks.id,
					slug: shortLinks.slug,
					destinationUrl: shortLinks.destinationUrl,
					title: shortLinks.title,
					previewTitle: shortLinks.previewTitle,
					previewDescription: shortLinks.previewDescription,
					previewImageKey: shortLinks.previewImageKey,
				})
				.from(shortLinks)
				.where(eq(shortLinks.slug, normalized))
				.limit(1)) as ResolvedLink[];
			return link ?? null;
		},
		async recordClick(linkId, input) {
			// Upsert-increment the rollup row, then bump the denormalized total. Both are best-effort:
			// callers run this in the background after responding, so a thrown error never blocks a redirect.
			await db
				.insert(linkDailyStats)
				.values({ linkId, date: input.date, referrerBucket: input.referrerBucket, deviceBucket: input.deviceBucket, count: 1 })
				.onConflictDoUpdate({
					target: [linkDailyStats.linkId, linkDailyStats.date, linkDailyStats.referrerBucket, linkDailyStats.deviceBucket],
					set: { count: sql`${linkDailyStats.count} + 1` },
				});
			await db.update(shortLinks).set({ clickCount: sql`${shortLinks.clickCount} + 1` }).where(eq(shortLinks.id, linkId));
		},
	};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- links.integration.test.ts`
Expected: PASS (all 6 cases). If `db.select()` chaining type errors surface, they are confined to this file's `LinkDb` shape; widen `LinkDb` (keep it `any`-returning like above) rather than touching call sites.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS. `repositories/index.ts` already calls `createLinksRepository()` with no args in both factories — Step 6 fixes those call sites.

- [ ] **Step 6: Wire the new signature into `repositories/index.ts`**

In `src/db/repositories/index.ts`, the two `createLinksRepository()` calls now need `(db, audit)`. In `createDrizzleRepositories`, change `links: createLinksRepository(),` to:
```ts
		links: createLinksRepository(db, audit),
```
In `createSharedRepositories`, the shared path has no Drizzle handle; leave links unavailable there for now (links shared-mode parity is exercised through the `/internal/links` handler in Task 7, not this adapter). Change `links: createLinksRepository(),` to:
```ts
		links: createUnavailableLinksRepository(),
```
and add to `src/db/repositories/links.ts` (end of file):
```ts
export function createUnavailableLinksRepository(): LinksRepository {
	const unavailable = async () => {
		throw new Error("Links are unavailable through this repository adapter.");
	};
	return {
		listOwn: unavailable as LinksRepository["listOwn"],
		listAll: unavailable as LinksRepository["listAll"],
		getById: unavailable as LinksRepository["getById"],
		create: unavailable as LinksRepository["create"],
		update: unavailable as LinksRepository["update"],
		remove: unavailable as LinksRepository["remove"],
		getStats: unavailable as LinksRepository["getStats"],
		resolveForRedirect: unavailable as LinksRepository["resolveForRedirect"],
		recordClick: unavailable as LinksRepository["recordClick"],
	};
}
```
Add `createUnavailableLinksRepository` to the existing `import { createLinksRepository } from "./links";` line in `index.ts`:
```ts
import { createLinksRepository, createUnavailableLinksRepository } from "./links";
```

- [ ] **Step 7: Run typecheck and the full suite**

Run: `pnpm typecheck && pnpm test -- links.integration.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/repositories/links.ts src/db/repositories/links.integration.test.ts src/db/repositories/index.ts
git commit -m "feat(links): implement repository CRUD, ownership, analytics, and fail-open click upsert"
```

---

### Task 4: Links contract — typed operations for the API and internal proxy

**Files:**
- Create: `src/db/contract/links.ts`
- Modify: `src/db/contract/index.ts`

**Interfaces:**
- Consumes: `operation` from `./common`; `z` from zod.
- Produces: `linksContract` with `listOwn`, `listAll`, `get`, `create`, `update`, `remove`, `stats` operations; `linkOutputSchema`, `createLinkInputSchema`, `updateLinkInputSchema`, `linkStatsOutputSchema`. Tasks 5 (`/api/links`) and 7 (`/internal/links`) consume these for parse/validation.

- [ ] **Step 1: Write `src/db/contract/links.ts`**

```ts
import { z } from "zod";
import { operation } from "./common";

export const linkOutputSchema = z.object({
	id: z.string(),
	slug: z.string(),
	destinationUrl: z.string(),
	title: z.string(),
	ownerMemberId: z.string(),
	clickCount: z.number().int(),
	previewTitle: z.string().nullable(),
	previewDescription: z.string().nullable(),
	previewImageKey: z.string().nullable(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
});

export const createLinkInputSchema = z.object({
	slug: z.string().trim().min(1).max(64),
	destinationUrl: z.string().trim().url().max(2048),
	title: z.string().trim().min(1).max(120),
});

export const updateLinkInputSchema = z.object({
	id: z.string().min(1),
	destinationUrl: z.string().trim().url().max(2048).optional(),
	title: z.string().trim().min(1).max(120).optional(),
	previewTitle: z.string().trim().max(120).nullable().optional(),
	previewDescription: z.string().trim().max(300).nullable().optional(),
	previewImageKey: z.string().trim().max(256).nullable().optional(),
});

export const linkStatsOutputSchema = z.object({
	link: linkOutputSchema,
	series: z.array(z.object({ date: z.string(), count: z.number().int() })),
	referrers: z.array(z.object({ bucket: z.string(), count: z.number().int() })),
	devices: z.array(z.object({ bucket: z.string(), count: z.number().int() })),
});

const pageInput = z.object({
	limit: z.number().int().min(1).max(50).default(25),
	offset: z.number().int().min(0).default(0),
});

export const linksContract = {
	listOwn: operation({
		input: pageInput,
		output: z.object({ links: z.array(linkOutputSchema) }),
		auth: "member",
		sharedDev: "allow",
	}),
	listAll: operation({
		input: pageInput,
		output: z.object({ links: z.array(linkOutputSchema) }),
		auth: "admin",
		permission: "link:moderate",
		sharedDev: "allow",
	}),
	get: operation({
		input: z.object({ id: z.string().min(1) }),
		output: z.object({ link: linkOutputSchema.nullable() }),
		auth: "member",
		sharedDev: "allow",
	}),
	create: operation({
		input: createLinkInputSchema,
		output: z.object({ link: linkOutputSchema }),
		auth: "member",
		sharedDev: "deny",
	}),
	update: operation({
		input: updateLinkInputSchema,
		output: z.object({ link: linkOutputSchema }),
		auth: "member",
		sharedDev: "deny",
	}),
	remove: operation({
		input: z.object({ id: z.string().min(1) }),
		output: z.object({}),
		auth: "member",
		sharedDev: "deny",
	}),
	stats: operation({
		input: z.object({ id: z.string().min(1) }),
		output: linkStatsOutputSchema,
		auth: "member",
		sharedDev: "allow",
	}),
};
```

- [ ] **Step 2: Export it from the contract index**

In `src/db/contract/index.ts`, add:
```ts
export { linksContract } from "./links";
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/db/contract/links.ts src/db/contract/index.ts
git commit -m "feat(links): add typed contract for link CRUD, moderation, and stats"
```

---

### Task 5: `/api/links` route handlers — same-origin owner CRUD + admin moderation

**Files:**
- Create: `src/server/links/handlers.ts`
- Create: `src/server/links/handlers.test.ts`
- Create: `src/app/api/links/route.ts`
- Create: `src/app/api/links/[id]/route.ts`
- Create: `src/app/api/links/[id]/stats/route.ts`

**Interfaces:**
- Consumes: `linksContract` (Task 4); `getActor`/`requireActor` from `@/server/auth/actor`; `assertSameOrigin` from `@/server/http/origin`; `getRepositories` from `@/db`; `proxySharedApiRequest` from `@/server/shared-api`; `getAppConfig` from `@/server/env`.
- Produces: `createLinksHandlers(deps)` returning `{ collection(request), item(request, id), stats(request, id) }`, dependency-injected with `getActor` + `getRepositories` so it is testable without HTTP. The route files are thin wrappers (mirror `src/app/api/uploads/route.ts`): they call `assertSameOrigin` on mutations, proxy to `/internal/links*` when `APP_ENV==='shared'`, then delegate.

- [ ] **Step 1: Write the failing handler test**

Create `src/server/links/handlers.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { createLinksHandlers } from "./handlers";

const owner: Actor = { memberId: "mem_owner", roles: ["member"] };

function depsWith(overrides: Record<string, unknown>) {
	const repo = {
		listOwn: vi.fn(async () => []),
		listAll: vi.fn(async () => []),
		getById: vi.fn(async () => null),
		create: vi.fn(async () => ({ id: "lnk_1", slug: "welcome" })),
		update: vi.fn(async () => ({ id: "lnk_1", slug: "welcome", title: "Updated" })),
		remove: vi.fn(async () => {}),
		getStats: vi.fn(async () => ({ link: { id: "lnk_1" }, series: [], referrers: [], devices: [] })),
		...overrides,
	};
	return {
		getActor: async () => owner as Actor | null,
		getRepositories: async () => ({ links: repo }) as never,
		repo,
	};
}

describe("links handlers", () => {
	it("rejects an unauthenticated collection request", async () => {
		const deps = depsWith({});
		const handlers = createLinksHandlers({ getActor: async () => null, getRepositories: deps.getRepositories });
		const res = await handlers.collection(new Request("https://app/api/links", { method: "GET" }));
		expect(res.status).toBe(401);
	});

	it("creates a link from a POST body", async () => {
		const deps = depsWith({});
		const handlers = createLinksHandlers(deps);
		const res = await handlers.collection(
			new Request("https://app/api/links", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ slug: "welcome", destinationUrl: "https://example.com", title: "Welcome" }),
			}),
		);
		expect(res.status).toBe(201);
		expect(deps.repo.create).toHaveBeenCalledOnce();
	});

	it("returns 403 when the repository rejects on authorization", async () => {
		const deps = depsWith({ update: vi.fn(async () => { throw new Error("Not authorized to access this link."); }) });
		const handlers = createLinksHandlers(deps);
		const res = await handlers.item(
			new Request("https://app/api/links/lnk_1", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: "x" }),
			}),
			"lnk_1",
		);
		expect(res.status).toBe(403);
	});

	it("deletes via the item handler", async () => {
		const deps = depsWith({});
		const handlers = createLinksHandlers(deps);
		const res = await handlers.item(new Request("https://app/api/links/lnk_1", { method: "DELETE" }), "lnk_1");
		expect(res.status).toBe(204);
		expect(deps.repo.remove).toHaveBeenCalledWith(owner, "lnk_1");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- handlers.test.ts`
Expected: FAIL — `./handlers` does not exist yet.

- [ ] **Step 3: Write `src/server/links/handlers.ts`**

```ts
import { linksContract } from "@/db/contract/links";
import type { Repositories } from "@/db/repositories";
import type { Actor } from "@/server/auth/permissions";

type LinksHandlerDependencies = {
	getActor(): Promise<Actor | null>;
	getRepositories(): Promise<Repositories>;
};

function fail(error: unknown): Response {
	const message = error instanceof Error ? error.message : "Request failed.";
	const status = message.startsWith("Not authorized") ? 403 : 400;
	return Response.json({ error: message }, { status });
}

export function createLinksHandlers(deps: LinksHandlerDependencies) {
	return {
		async collection(request: Request): Promise<Response> {
			const actor = await deps.getActor();
			if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
			const { links } = await deps.getRepositories();

			if (request.method === "GET") {
				const url = new URL(request.url);
				const scope = url.searchParams.get("scope");
				const input = (scope === "all" ? linksContract.listAll : linksContract.listOwn).input.parse({
					limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
					offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
				});
				try {
					const result = scope === "all" ? await links.listAll(actor, input) : await links.listOwn(actor, input);
					return Response.json({ links: result });
				} catch (error) {
					return fail(error);
				}
			}

			if (request.method === "POST") {
				try {
					const input = linksContract.create.input.parse(await request.json());
					const link = await links.create(actor, input);
					return Response.json({ link }, { status: 201 });
				} catch (error) {
					return fail(error);
				}
			}

			return new Response("Method not allowed", { status: 405 });
		},

		async item(request: Request, id: string): Promise<Response> {
			const actor = await deps.getActor();
			if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
			const { links } = await deps.getRepositories();

			if (request.method === "GET") {
				try {
					const link = await links.getById(actor, id);
					return Response.json({ link }, { status: link ? 200 : 404 });
				} catch (error) {
					return fail(error);
				}
			}
			if (request.method === "PATCH") {
				try {
					const input = linksContract.update.input.parse({ ...(await request.json()), id });
					const { id: _id, ...patch } = input;
					const link = await links.update(actor, id, patch);
					return Response.json({ link });
				} catch (error) {
					return fail(error);
				}
			}
			if (request.method === "DELETE") {
				try {
					await links.remove(actor, id);
					return new Response(null, { status: 204 });
				} catch (error) {
					return fail(error);
				}
			}
			return new Response("Method not allowed", { status: 405 });
		},

		async stats(request: Request, id: string): Promise<Response> {
			const actor = await deps.getActor();
			if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
			if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
			const { links } = await deps.getRepositories();
			try {
				return Response.json(await links.getStats(actor, id));
			} catch (error) {
				return fail(error);
			}
		},
	};
}
```

- [ ] **Step 4: Run the handler test to verify it passes**

Run: `pnpm test -- handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the three route files**

Create `src/app/api/links/route.ts`:
```ts
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { createLinksHandlers } from "@/server/links/handlers";
import { proxySharedApiRequest } from "@/server/shared-api";

function handlers() {
	return createLinksHandlers({ getActor, getRepositories });
}

export async function GET(request: Request) {
	const config = getAppConfig();
	if (config.APP_ENV === "shared") return proxySharedApiRequest(request, "/internal/links");
	return handlers().collection(request);
}

export async function POST(request: Request) {
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	if (config.APP_ENV === "shared") return proxySharedApiRequest(request, "/internal/links");
	return handlers().collection(request);
}
```

Create `src/app/api/links/[id]/route.ts`:
```ts
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { assertSameOrigin } from "@/server/http/origin";
import { createLinksHandlers } from "@/server/links/handlers";
import { proxySharedApiRequest } from "@/server/shared-api";

type Context = { params: Promise<{ id: string }> };

function handlers() {
	return createLinksHandlers({ getActor, getRepositories });
}

export async function GET(request: Request, context: Context) {
	const { id } = await context.params;
	const config = getAppConfig();
	if (config.APP_ENV === "shared") return proxySharedApiRequest(request, `/internal/links/${encodeURIComponent(id)}`);
	return handlers().item(request, id);
}

export async function PATCH(request: Request, context: Context) {
	const { id } = await context.params;
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	if (config.APP_ENV === "shared") return proxySharedApiRequest(request, `/internal/links/${encodeURIComponent(id)}`);
	return handlers().item(request, id);
}

export async function DELETE(request: Request, context: Context) {
	const { id } = await context.params;
	const config = getAppConfig();
	try {
		assertSameOrigin(request, config.APP_BASE_URL);
	} catch {
		return Response.json({ error: "Cross-origin request rejected." }, { status: 403 });
	}
	if (config.APP_ENV === "shared") return proxySharedApiRequest(request, `/internal/links/${encodeURIComponent(id)}`);
	return handlers().item(request, id);
}
```

Create `src/app/api/links/[id]/stats/route.ts`:
```ts
import { getRepositories } from "@/db";
import { getActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import { createLinksHandlers } from "@/server/links/handlers";
import { proxySharedApiRequest } from "@/server/shared-api";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
	const { id } = await context.params;
	const config = getAppConfig();
	if (config.APP_ENV === "shared") return proxySharedApiRequest(request, `/internal/links/${encodeURIComponent(id)}/stats`);
	return createLinksHandlers({ getActor, getRepositories }).stats(request, id);
}
```

- [ ] **Step 6: Run typecheck, lint, and the handler test**

Run: `pnpm typecheck && pnpm lint && pnpm test -- handlers.test.ts`
Expected: PASS. If `proxySharedApiRequest`'s signature differs from the two-arg `(request, path)` shape used in `src/app/api/uploads/route.ts`, match that file's exact call.

- [ ] **Step 7: Commit**

```bash
git add src/server/links src/app/api/links
git commit -m "feat(links): add same-origin /api/links CRUD, moderation, and stats routes"
```

---

### Task 6: `/l/[slug]` redirect, fail-open stats, and crawler OG preview branch

**Files:**
- Create: `src/server/links/redirect.ts`
- Create: `src/server/links/redirect.test.ts`
- Create: `src/app/l/[slug]/route.ts`

**Interfaces:**
- Consumes: `resolveForRedirect`/`recordClick` from the links repository (Task 3); `isCrawlerUserAgent`/`renderPreviewHtml` from `@/lib/crawlers` (Task 2); `referrerBucket`/`deviceBucket` from `@/lib/links` (Task 1); `runInBackground` from `@/server/cloudflare`.
- Produces: `buildRedirectResponse(deps, request)` — a pure-ish function that takes injected `resolveForRedirect`, `recordClick`, `scheduleBackground`, and `previewImageBaseUrl`, returns the `Response` (302 for humans, 200 OG-HTML for crawlers, 404 when unknown), and schedules the click upsert through the injected background scheduler. The route file injects the real repository + `runInBackground` + `config.APP_BASE_URL`.

- [ ] **Step 1: Write the failing test**

Create `src/server/links/redirect.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { buildRedirectResponse } from "./redirect";

const link = {
	id: "lnk_1",
	slug: "welcome",
	destinationUrl: "https://example.com/dest",
	title: "Welcome",
	previewTitle: "Preview Title",
	previewDescription: "Preview Description",
	previewImageKey: "links/lnk_1/preview/img.png",
};

function deps(overrides: Record<string, unknown> = {}) {
	return {
		resolveForRedirect: vi.fn(async (slug: string) => (slug === "welcome" ? link : null)),
		recordClick: vi.fn(async () => {}),
		scheduleBackground: vi.fn((task: Promise<unknown>) => void task),
		previewImageBaseUrl: "https://app.example",
		...overrides,
	};
}

describe("buildRedirectResponse", () => {
	it("302s a normal browser and schedules a click upsert in the background", async () => {
		const d = deps();
		const res = await buildRedirectResponse(
			d,
			new Request("https://app.example/l/welcome", {
				headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120", referer: "https://www.google.com/" },
			}),
		);
		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe("https://example.com/dest");
		expect(d.scheduleBackground).toHaveBeenCalledOnce();
		expect(d.recordClick).toHaveBeenCalledOnce();
	});

	it("serves OG HTML (not a 302) to a crawler and does NOT need the click to succeed", async () => {
		const d = deps({ recordClick: vi.fn(async () => { throw new Error("stats down"); }) });
		const res = await buildRedirectResponse(
			d,
			new Request("https://app.example/l/welcome", { headers: { "user-agent": "facebookexternalhit/1.1" } }),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		const body = await res.text();
		expect(body).toContain('property="og:title" content="Preview Title"');
		expect(body).toContain("links/lnk_1/preview/img.png");
	});

	it("404s an unknown slug", async () => {
		const d = deps();
		const res = await buildRedirectResponse(d, new Request("https://app.example/l/missing"));
		expect(res.status).toBe(404);
		expect(d.scheduleBackground).not.toHaveBeenCalled();
	});

	it("never throws when the background click write rejects (fail-open)", async () => {
		const d = deps({
			recordClick: vi.fn(async () => { throw new Error("stats down"); }),
			scheduleBackground: (task: Promise<unknown>) => void task.catch(() => {}),
		});
		const res = await buildRedirectResponse(
			d,
			new Request("https://app.example/l/welcome", { headers: { "user-agent": "Chrome" } }),
		);
		expect(res.status).toBe(302);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- redirect.test.ts`
Expected: FAIL — `./redirect` does not exist yet.

- [ ] **Step 3: Write `src/server/links/redirect.ts`**

```ts
import { isCrawlerUserAgent, renderPreviewHtml } from "@/lib/crawlers";
import { deviceBucket, referrerBucket } from "@/lib/links";
import type { ResolvedLink } from "@/db/repositories/links";

export type RedirectDependencies = {
	resolveForRedirect(slug: string): Promise<ResolvedLink | null>;
	recordClick(linkId: string, input: { date: string; referrerBucket: string; deviceBucket: string }): Promise<void>;
	scheduleBackground(task: Promise<unknown>): void;
	previewImageBaseUrl: string;
};

export async function buildRedirectResponse(deps: RedirectDependencies, request: Request): Promise<Response> {
	const slug = new URL(request.url).pathname.replace(/^\/l\//, "");
	const link = await deps.resolveForRedirect(slug);
	if (!link) return new Response("Not found", { status: 404 });

	const userAgent = request.headers.get("user-agent");

	// Analytics is fail-open: schedule the upsert after responding, swallow any error, and never
	// let it influence the response. This runs for both the crawler and human branches.
	deps.scheduleBackground(
		deps
			.recordClick(link.id, {
				date: new Date().toISOString().slice(0, 10),
				referrerBucket: referrerBucket(request.headers.get("referer")),
				deviceBucket: deviceBucket(userAgent),
			})
			.catch(() => {}),
	);

	if (isCrawlerUserAgent(userAgent)) {
		const imageUrl = link.previewImageKey
			? new URL(`/api/uploads/${encodeURIComponent(link.previewImageKey)}`, deps.previewImageBaseUrl).toString()
			: null;
		const html = renderPreviewHtml({
			title: link.previewTitle ?? link.title,
			description: link.previewDescription,
			imageUrl,
			destinationUrl: link.destinationUrl,
		});
		return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
	}

	return new Response(null, { status: 302, headers: { location: link.destinationUrl } });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- redirect.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Write `src/app/l/[slug]/route.ts`**

```ts
import { getRepositories } from "@/db";
import { getAppConfig } from "@/server/env";
import { runInBackground } from "@/server/cloudflare";
import { buildRedirectResponse } from "@/server/links/redirect";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const config = getAppConfig();
	const { links } = await getRepositories();
	return buildRedirectResponse(
		{
			resolveForRedirect: (slug) => links.resolveForRedirect(slug),
			recordClick: (linkId, input) => links.recordClick(linkId, input),
			scheduleBackground: runInBackground,
			previewImageBaseUrl: config.APP_BASE_URL ?? new URL(request.url).origin,
		},
		request,
	);
}
```

- [ ] **Step 6: Run typecheck, lint, and the redirect test**

Run: `pnpm typecheck && pnpm lint && pnpm test -- redirect.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/links/redirect.ts src/server/links/redirect.test.ts src/app/l
git commit -m "feat(links): add /l/[slug] redirect with fail-open stats and crawler OG preview"
```

---

### Task 7: `/internal/links` per-domain shared-dev handler + parity test

**Files:**
- Create: `src/server/internal/links.ts`
- Create: `src/app/internal/links/route.ts`
- Create: `src/app/internal/links/[id]/route.ts`
- Create: `src/app/internal/links/[id]/stats/route.ts`
- Modify: `src/db/shared-parity.integration.test.ts` (append a links-parity describe block)

**Interfaces:**
- Consumes: `linksContract` (Task 4); `createLinksRepository`/`createAuditRepository` (Task 3); `resolveSharedActor` from `./shared-actor`; `getInternalCorsHeaders` from `./cors`; `DeployEnv` from `@/server/env`.
- Produces: `createLinksInternalHandlers({ db, deployEnv, allowedOrigins? })` returning `{ collection(request), item(request, id), stats(request, id) }`, each guarded by `deployEnv==='dev'` (404 otherwise), CORS allowlist, bearer→actor, and the per-op `sharedDev` gate. Mirrors `src/server/internal/members.ts` exactly.

- [ ] **Step 1: Write `src/server/internal/links.ts`**

```ts
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { linksContract } from "@/db/contract/links";
import { createAuditRepository } from "@/db/repositories/audit";
import { createLinksRepository } from "@/db/repositories/links";
import type { DeployEnv } from "@/server/env";
import { getInternalCorsHeaders } from "./cors";
import { resolveSharedActor } from "./shared-actor";

type LinksInternalDependencies = {
	db: DrizzleD1Database<typeof schema>;
	deployEnv: DeployEnv;
	allowedOrigins?: string[];
};

export function createLinksInternalHandlers({ db, deployEnv, allowedOrigins = [] }: LinksInternalDependencies) {
	const repository = createLinksRepository(db, createAuditRepository(db));

	async function guard(request: Request): Promise<{ headers: Headers | undefined; actor: Awaited<ReturnType<typeof resolveSharedActor>>; early?: Response }> {
		const corsHeaders = getInternalCorsHeaders(request, allowedOrigins);
		if (request.method === "OPTIONS") {
			return { headers: undefined, actor: null, early: new Response(null, { status: corsHeaders ? 204 : 403, headers: corsHeaders ?? undefined }) };
		}
		if (request.headers.has("origin") && !corsHeaders) {
			return { headers: undefined, actor: null, early: Response.json({ error: "Origin is not allowed." }, { status: 403 }) };
		}
		const headers = corsHeaders ?? undefined;
		const actor = await resolveSharedActor(db, request);
		if (!actor) {
			return { headers, actor: null, early: Response.json({ error: "Invalid shared development token." }, { status: 401, headers }) };
		}
		return { headers, actor };
	}

	function deny(headers: Headers | undefined): Response {
		return Response.json({ error: "Operation is disabled in shared development." }, { status: 403, headers });
	}
	function fail(error: unknown, headers: Headers | undefined): Response {
		const message = error instanceof Error ? error.message : "Internal request failed.";
		return Response.json({ error: message }, { status: message.startsWith("Not authorized") ? 403 : 400, headers });
	}

	return {
		async collection(request: Request): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });
			const { headers, actor, early } = await guard(request);
			if (early || !actor) return early!;
			try {
				if (request.method === "GET") {
					const url = new URL(request.url);
					const scope = url.searchParams.get("scope");
					const op = scope === "all" ? linksContract.listAll : linksContract.listOwn;
					const input = op.input.parse({
						limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
						offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
					});
					const links = scope === "all" ? await repository.listAll(actor, input) : await repository.listOwn(actor, input);
					return Response.json({ links }, { headers });
				}
				if (request.method === "POST") {
					if (linksContract.create.sharedDev === "deny") return deny(headers);
					const input = linksContract.create.input.parse(await request.json());
					const link = await repository.create(actor, input);
					return Response.json({ link }, { status: 201, headers });
				}
				return new Response("Method not allowed", { status: 405, headers });
			} catch (error) {
				return fail(error, headers);
			}
		},

		async item(request: Request, id: string): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });
			const { headers, actor, early } = await guard(request);
			if (early || !actor) return early!;
			try {
				if (request.method === "GET") {
					const link = await repository.getById(actor, id);
					return Response.json({ link }, { status: link ? 200 : 404, headers });
				}
				if (request.method === "PATCH") {
					if (linksContract.update.sharedDev === "deny") return deny(headers);
					const input = linksContract.update.input.parse({ ...(await request.json()), id });
					const { id: _id, ...patch } = input;
					const link = await repository.update(actor, id, patch);
					return Response.json({ link }, { headers });
				}
				if (request.method === "DELETE") {
					if (linksContract.remove.sharedDev === "deny") return deny(headers);
					await repository.remove(actor, id);
					return new Response(null, { status: 204, headers });
				}
				return new Response("Method not allowed", { status: 405, headers });
			} catch (error) {
				return fail(error, headers);
			}
		},

		async stats(request: Request, id: string): Promise<Response> {
			if (deployEnv !== "dev") return new Response("Not found", { status: 404 });
			const { headers, actor, early } = await guard(request);
			if (early || !actor) return early!;
			if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
			try {
				return Response.json(await repository.getStats(actor, id), { headers });
			} catch (error) {
				return fail(error, headers);
			}
		},
	};
}
```

- [ ] **Step 2: Write the three internal route files**

Create `src/app/internal/links/route.ts`:
```ts
import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { createLinksInternalHandlers } from "@/server/internal/links";
import { splitAllowedOrigins } from "@/server/internal/cors";

function getHandlers() {
	const config = getAppConfig();
	return createLinksInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	});
}

export async function GET(request: Request) {
	return getHandlers().collection(request);
}
export async function POST(request: Request) {
	return getHandlers().collection(request);
}
export async function OPTIONS(request: Request) {
	return getHandlers().collection(request);
}
```

Create `src/app/internal/links/[id]/route.ts`:
```ts
import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { createLinksInternalHandlers } from "@/server/internal/links";
import { splitAllowedOrigins } from "@/server/internal/cors";

type Context = { params: Promise<{ id: string }> };

function getHandlers() {
	const config = getAppConfig();
	return createLinksInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	});
}

export async function GET(request: Request, context: Context) {
	const { id } = await context.params;
	return getHandlers().item(request, id);
}
export async function PATCH(request: Request, context: Context) {
	const { id } = await context.params;
	return getHandlers().item(request, id);
}
export async function DELETE(request: Request, context: Context) {
	const { id } = await context.params;
	return getHandlers().item(request, id);
}
export async function OPTIONS(request: Request, context: Context) {
	const { id } = await context.params;
	return getHandlers().item(request, id);
}
```

Create `src/app/internal/links/[id]/stats/route.ts`:
```ts
import { getD1Db } from "@/db/client";
import { getAppConfig } from "@/server/env";
import { createLinksInternalHandlers } from "@/server/internal/links";
import { splitAllowedOrigins } from "@/server/internal/cors";

type Context = { params: Promise<{ id: string }> };

function getHandlers() {
	const config = getAppConfig();
	return createLinksInternalHandlers({
		db: getD1Db(),
		deployEnv: config.DEPLOY_ENV ?? "prod",
		allowedOrigins: splitAllowedOrigins(config.SHARED_API_ALLOWED_ORIGINS),
	});
}

export async function GET(request: Request, context: Context) {
	const { id } = await context.params;
	return getHandlers().stats(request, id);
}
export async function OPTIONS(request: Request, context: Context) {
	const { id } = await context.params;
	return getHandlers().stats(request, id);
}
```

- [ ] **Step 3: Append a links-parity block to `src/db/shared-parity.integration.test.ts`**

Add this `describe` block at the end of the file (it reuses the file's existing `hashToken` helper and `cloudflare:test` `env`):
```ts
describe("shared links parity", () => {
	beforeEach(async () => {
		await env.DB.batch([
			env.DB.prepare("DELETE FROM short_links"),
			env.DB.prepare("DELETE FROM shared_dev_tokens"),
			env.DB.prepare("DELETE FROM member_roles"),
			env.DB.prepare("DELETE FROM roles"),
			env.DB.prepare("DELETE FROM members"),
		]);
		const db = drizzle(env.DB, { schema });
		await db.insert(members).values({ id: "mem_links_owner", email: "links@example.com", name: "Links Owner" });
		await db.insert(sharedDevTokens).values({
			tokenHash: await hashToken("links-token"),
			memberId: "mem_links_owner",
			label: "Links token",
		});
	});

	it("lists a member's own links over the proxy and refuses create in shared mode", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createLinksInternalHandlers({ db, deployEnv: "dev" });

		const created = await handlers.collection(
			new Request("https://dev.example/internal/links", {
				method: "POST",
				headers: { authorization: "Bearer links-token", "content-type": "application/json" },
				body: JSON.stringify({ slug: "welcome", destinationUrl: "https://example.com", title: "Welcome" }),
			}),
		);
		expect(created.status).toBe(403);
		expect(await created.json()).toEqual({ error: "Operation is disabled in shared development." });

		const listed = await handlers.collection(
			new Request("https://dev.example/internal/links", { headers: { authorization: "Bearer links-token" } }),
		);
		expect(listed.status).toBe(200);
		expect(await listed.json()).toEqual({ links: [] });
	});

	it("returns 404 outside the dev Worker", async () => {
		const db = drizzle(env.DB, { schema });
		const handlers = createLinksInternalHandlers({ db, deployEnv: "prod" });
		const response = await handlers.collection(new Request("https://prod.example/internal/links"));
		expect(response.status).toBe(404);
	});
});
```

Add the import near the file's other internal-handler imports:
```ts
import { createLinksInternalHandlers } from "@/server/internal/links";
```

- [ ] **Step 4: Run the parity test, typecheck, and lint**

Run: `pnpm test -- shared-parity.integration.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/internal/links.ts src/app/internal/links src/db/shared-parity.integration.test.ts
git commit -m "feat(links): add /internal/links shared-dev handler with parity coverage"
```

---

### Task 8: Link preview image upload namespace (`links/{linkId}/preview`, public GET)

**Files:**
- Modify: `src/server/uploads.ts` (add the `link_preview` purpose + the `links/.../preview` namespace; make that namespace's GET public)
- Modify: `src/server/uploads.test.ts` (add cases for the new purpose + public GET)
- Modify: `src/db/contract/uploads.ts` (extend the `purpose` enum)

**Interfaces:**
- Consumes: `canModerateLink`-style ownership check injected into `UploadHandlerDependencies` (new `canEditLink(actor, linkId)` dependency, wired from the links repository's `getById` in the route layer).
- Produces: server-assigned key `links/{linkId}/{memberId}/{id}.{ext}`; `parseNamespace` recognizes `links` and returns `{ ownerMemberId, public: true }` so `/api/uploads/[key]` GET serves it without auth (crawlers fetch it), while DELETE still requires ownership/admin.

- [ ] **Step 1: Add the failing upload tests**

`src/server/uploads.test.ts` already builds handlers through a local `createHandlers(actor)` helper (returns `createUploadHandlers({ getActor: async () => actor, storage, canPostEvent, ... })`) and an `imageForm()` builder, with a fake `storage` defined in-file. First extend that local `createHandlers` helper to also pass a `canEditLink` dependency (default `async () => false`, overridable per test) and ensure the in-file fake `storage.getObject` returns a non-null `body` (e.g. `{ body: new ReadableStream(), contentType: "image/png" }`) so the public-GET case can succeed. Then add these cases (using the same `createHandlers`/`imageForm` conventions already in the file):
```ts
it("assigns a server key for a link preview image the actor may edit", async () => {
	const handlers = createHandlers(memberActor, { canEditLink: async (_a, id) => id === "lnk_ok" });
	const form = imageForm();
	form.set("purpose", "link_preview");
	form.set("linkId", "lnk_ok");
	const res = await handlers.collection(new Request("https://example.com/api/uploads", { method: "POST", body: form }));
	expect(res.status).toBe(201);
	expect((await res.json()).key).toMatch(/^links\/lnk_ok\/mem_upload\/.+/);
});

it("rejects a link preview upload the actor may not edit", async () => {
	const handlers = createHandlers(memberActor, { canEditLink: async () => false });
	const form = imageForm();
	form.set("purpose", "link_preview");
	form.set("linkId", "lnk_no");
	const res = await handlers.collection(new Request("https://example.com/api/uploads", { method: "POST", body: form }));
	expect(res.status).toBe(403);
});

it("serves a link preview image without authentication", async () => {
	const handlers = createHandlers(null);
	const res = await handlers.object(
		new Request("https://example.com/api/uploads/links/lnk_ok/mem_upload/img.png", { method: "GET" }),
		"links/lnk_ok/mem_upload/img.png",
	);
	expect(res.status).toBe(200);
});
```
(`imageForm()` already sets a valid `image/png` file; the preview tests only override `purpose` + `linkId`. If the existing `createHandlers` helper has a fixed dependency set, widen its signature to accept an optional overrides object so `canEditLink` can be injected per test without disturbing the other cases.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- uploads.test.ts`
Expected: FAIL — `canEditLink` is not a known dependency and `link_preview` is an unknown purpose.

- [ ] **Step 3: Extend `src/server/uploads.ts`**

Add `canEditLink` to `UploadHandlerDependencies`:
```ts
type UploadHandlerDependencies = {
	getActor(request: Request): Promise<Actor | null>;
	storage: StorageAdapter;
	canPostEvent(actor: Actor, eventId: string): Promise<boolean>;
	canEditLink(actor: Actor, linkId: string): Promise<boolean>;
};
```

In `collection`, add a `link_preview` branch alongside the existing `avatar` / `event_media` branches (before the final `else` that returns "Unknown upload purpose."):
```ts
} else if (purpose === "link_preview") {
	const linkId = form.get("linkId");
	if (typeof linkId !== "string" || !isSafeSegment(linkId)) {
		return Response.json({ error: "A valid link is required." }, { status: 400 });
	}
	if (!(await dependencies.canEditLink(actor, linkId))) {
		return Response.json({ error: "Not authorized to upload a preview for this link." }, { status: 403 });
	}
	key = `links/${linkId}/${actor.memberId}/${createId("preview")}.${extension}`;
}
```

In `object`, make the link-preview namespace publicly readable. Replace the top of `object` so a public namespace skips the auth requirement for GET:
```ts
async object(request: Request, key: string): Promise<Response> {
	const namespace = parseNamespace(key);
	if (!namespace) return Response.json({ error: "Object not found." }, { status: 404 });

	if (request.method === "GET") {
		if (!namespace.public) {
			const actor = await dependencies.getActor(request);
			if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });
		}
		const object = await dependencies.storage.getObject(key);
		if (!object.body) return Response.json({ error: "Object not found." }, { status: 404 });
		return new Response(object.body, {
			headers: { "Content-Type": object.contentType ?? "application/octet-stream" },
		});
	}

	const actor = await dependencies.getActor(request);
	if (!actor) return Response.json({ error: "Authentication required." }, { status: 401 });

	if (request.method === "DELETE") {
		const ownsObject = namespace.ownerMemberId === actor.memberId;
		if (!ownsObject && !can(actor, "member:manage")) {
			return Response.json({ error: "Not authorized to delete this object." }, { status: 403 });
		}
		await dependencies.storage.deleteObject(key);
		return new Response(null, { status: 204 });
	}

	return new Response("Method not allowed", { status: 405 });
},
```

Update `parseNamespace` to add the `links` namespace and a `public` flag on the return type:
```ts
function parseNamespace(key: string): { ownerMemberId: string; public: boolean } | null {
	if (key.includes("..") || key.startsWith("/")) return null;
	const parts = key.split("/");
	if (parts[0] === "avatars" && parts.length === 3 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[1], public: false };
	}
	if (parts[0] === "events" && parts.length === 4 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[2], public: false };
	}
	if (parts[0] === "links" && parts.length === 4 && parts.every(isSafeSegment)) {
		return { ownerMemberId: parts[2], public: true };
	}
	return null;
}
```

- [ ] **Step 4: Extend the uploads contract purpose enum**

In `src/db/contract/uploads.ts`, change the `put` input `purpose` enum:
```ts
purpose: z.enum(["avatar", "event_media", "link_preview"]),
```

- [ ] **Step 5: Wire `canEditLink` into the three upload entry points**

The `createUploadHandlers(...)` call now requires `canEditLink`. Add it in all three callers, each loading the link via the links repository's `getById` and allowing the owner or a `link:moderate` actor.

In `src/app/api/uploads/route.ts` and `src/app/api/uploads/[key]/route.ts`, inside `createHandlers()`:
```ts
canEditLink: async (actor, linkId) => {
	const { links } = await getRepositories();
	try {
		const link = await links.getById(actor, linkId);
		return Boolean(link);
	} catch {
		return false;
	}
},
```
(add `import { getRepositories } from "@/db";` to both route files).

In `src/server/internal/uploads.ts`, inside `createUploadHandlers(...)`:
```ts
canEditLink: async (actor, linkId) => {
	const repository = createLinksRepository(db, createAuditRepository(db));
	try {
		return Boolean(await repository.getById(actor, linkId));
	} catch {
		return false;
	}
},
```
(add `import { createLinksRepository } from "@/db/repositories/links";` and `import { createAuditRepository } from "@/db/repositories/audit";` to `src/server/internal/uploads.ts`).

Note: `links.getById` returns null only when the link does not exist and throws "Not authorized" when the actor is neither owner nor moderator, so `Boolean(link)` plus the `catch` correctly maps to allow-owner-or-moderator.

- [ ] **Step 6: Run the upload tests, typecheck, and lint**

Run: `pnpm test -- uploads.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS. The existing shared-parity upload-delete test still passes because `link_preview` does not change the avatar/event delete paths.

- [ ] **Step 7: Commit**

```bash
git add src/server/uploads.ts src/server/uploads.test.ts src/db/contract/uploads.ts src/app/api/uploads src/server/internal/uploads.ts
git commit -m "feat(uploads): add public link-preview image namespace with owner-scoped writes"
```

---

### Task 9: Seed reserved slugs + a richer link sample for the analytics view

**Files:**
- Modify: `src/db/seed/data.ts` (extend `seedReservedSlugs`, add preview fields + more `seedLinkDailyStats` rows)

**Interfaces:**
- Consumes: `RESERVED_SLUG_DEFAULTS` from `@/lib/links` (Task 1) for the reserved-slug seed.
- Produces: a seeded link with preview fields populated and a multi-day / multi-bucket `link_daily_stats` set so the analytics view and the crawler preview render against real data in dev/local.

- [ ] **Step 1: Seed the route-shadow reserved slugs**

In `src/db/seed/data.ts`, add the import:
```ts
import { RESERVED_SLUG_DEFAULTS } from "@/lib/links";
```
Replace `seedReservedSlugs` with:
```ts
export const seedReservedSlugs: InferInsertModel<typeof reservedSlugs>[] = RESERVED_SLUG_DEFAULTS.map((slug) => ({ slug }));
```

- [ ] **Step 2: Populate preview fields on the demo link and add stat rows**

Replace `seedShortLinks` with:
```ts
export const seedShortLinks: InferInsertModel<typeof shortLinks>[] = [
	{
		id: "lnk_demo",
		slug: "welcome",
		destinationUrl: "https://example.com/code",
		title: "Welcome link",
		ownerMemberId: "mem_demo_admin",
		clickCount: 9,
		previewTitle: "Welcome to CODE",
		previewDescription: "Ateneo CODE member resources and sign-in.",
		previewImageKey: null,
	},
];
```
Replace `seedLinkDailyStats` with:
```ts
export const seedLinkDailyStats: InferInsertModel<typeof linkDailyStats>[] = [
	{ linkId: "lnk_demo", date: "2026-06-17", referrerBucket: "direct", deviceBucket: "desktop", count: 3 },
	{ linkId: "lnk_demo", date: "2026-06-18", referrerBucket: "www.facebook.com", deviceBucket: "mobile", count: 4 },
	{ linkId: "lnk_demo", date: "2026-06-18", referrerBucket: "direct", deviceBucket: "desktop", count: 2 },
];
```
(`seed/run.ts` already inserts `shortLinks` then `linkDailyStats` in order; no change needed there.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/db/seed/data.ts
git commit -m "feat(seed): seed route-shadow reserved slugs and a multi-day link stats sample"
```

---

### Task 10: Member links UI — list, create/edit, analytics, QR export

**Files:**
- Create: `src/app/portal/links/page.tsx` (server component: gate via `requireActor`, fetch own links via repository, render the client workspace)
- Create: `src/components/links/links-workspace.tsx` (client component: list + create/edit forms calling `/api/links*`)
- Create: `src/components/links/link-qr.tsx` (client component: client-side QR canvas + PNG download)
- Create: `src/components/links/link-qr.test.tsx` (renders the QR component with a stub matrix and asserts a canvas + download button exist)

**Interfaces:**
- Consumes: `requireActor` from `@/server/auth/actor`; `getRepositories` from `@/db`; shadcn `Button`/`Card`/`Input`/`Textarea`/`Tabs`/`Badge` from `@/components/ui/*`; `lucide-react` icons.
- Produces: `/portal/links` page; a `LinksWorkspace` client component that performs same-origin `fetch` to `/api/links` (GET/POST), `/api/links/[id]` (PATCH/DELETE), `/api/links/[id]/stats` (GET); a `LinkQr` component rendering the full short URL (`${origin}/l/${slug}`) as a downloadable QR.

- [ ] **Step 1: Add the QR dependency (no network op; just a dep install)**

QR generation must be client-side and self-contained. Run:
```bash
pnpm add qrcode
pnpm add -D @types/qrcode
```
Expected: `qrcode` + types added to `package.json`. (Master-plan §7: QR codes generated client-side on demand; not persisted to R2.)

- [ ] **Step 2: Write the QR component test**

Create `src/components/links/link-qr.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkQr } from "./link-qr";

vi.mock("qrcode", () => ({
	default: { toCanvas: vi.fn(async () => {}), toDataURL: vi.fn(async () => "data:image/png;base64,AAAA") },
}));

describe("LinkQr", () => {
	it("renders a download control for the short URL", async () => {
		render(<LinkQr url="https://app.example/l/welcome" />);
		expect(await screen.findByRole("button", { name: /download/i })).toBeTruthy();
	});
});
```
Note: if `@testing-library/react` + `jsdom` are not yet dev dependencies, add them and a `vitest` jsdom environment for `*.test.tsx` files. Check `vitest.config.mts` first; if the project has no component-test setup, SIMPLIFY this task by making `link-qr.test.tsx` a pure unit test of a `shortLinkUrl(origin, slug)` helper instead, and skip the React render test. Do not block the task on test-infra scope creep; the QR component itself is still required.

- [ ] **Step 3: Write `src/components/links/link-qr.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LinkQr({ url }: { url: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [dataUrl, setDataUrl] = useState<string | null>(null);

	useEffect(() => {
		if (canvasRef.current) {
			QRCode.toCanvas(canvasRef.current, url, { width: 192, margin: 1 }).catch(() => {});
		}
		QRCode.toDataURL(url, { width: 512, margin: 1 }).then(setDataUrl).catch(() => {});
	}, [url]);

	return (
		<div className="flex flex-col items-center gap-3">
			<canvas ref={canvasRef} className="rounded-md border" aria-label={`QR code for ${url}`} />
			<Button asChild variant="secondary" size="sm" disabled={!dataUrl}>
				<a href={dataUrl ?? "#"} download="short-link-qr.png">
					<Download />
					Download QR
				</a>
			</Button>
		</div>
	);
}
```

- [ ] **Step 4: Write `src/components/links/links-workspace.tsx`**

A client component with: a create form (slug, destination, title), a list of the member's links (each with copy-URL, edit-preview, view-stats, delete actions), an edit panel exposing `previewTitle`/`previewDescription` and a preview-image upload (POST to `/api/uploads` with `purpose=link_preview` + `linkId`, then PATCH the returned key onto the link), and a stats panel (fetch `/api/links/[id]/stats`, render the `series`/`referrers`/`devices` as simple shadcn `Card` + table lists; no charting dependency in v1). Use the `LinkQr` component for each link's short URL. All mutations are same-origin `fetch` with `credentials: "same-origin"` and `headers: { "content-type": "application/json" }`. Keep it one focused file; depth lives in tabs/panels, not nested cards (Global Constraints minimalism). Build entirely from the existing shadcn registry components; add any missing one with `pnpm dlx shadcn@latest add <component>`.

(Implementer note: this is UI glue with no new server contract; there is no unit test mandated for the workspace beyond `pnpm typecheck`/`pnpm lint`/`pnpm build`. The load-bearing behavior — validation, authz, stats, redirect, preview — is already covered by Tasks 1-8.)

- [ ] **Step 5: Write `src/app/portal/links/page.tsx`**

```tsx
import { requireActor } from "@/server/auth/actor";
import { getRepositories } from "@/db";
import { LinksWorkspace } from "@/components/links/links-workspace";

export const dynamic = "force-dynamic";

export default async function LinksPage() {
	const actor = await requireActor();
	const { links } = await getRepositories();
	const ownLinks = await links.listOwn(actor, { limit: 50 });
	const canModerate = actor.roles.includes("link") || actor.roles.includes("super");
	return <LinksWorkspace initialLinks={ownLinks} canModerate={canModerate} />;
}
```

- [ ] **Step 6: Run typecheck, lint, build, and any component test**

Run: `pnpm typecheck && pnpm lint && pnpm test -- link-qr && pnpm build`
Expected: PASS. (If the component test was simplified per Step 2's note, run that test name instead.)

- [ ] **Step 7: Commit**

```bash
git add src/app/portal/links src/components/links package.json pnpm-lock.yaml
git commit -m "feat(links): add member links workspace with create/edit, analytics, and QR export"
```

---

### Task 11: Admin link moderation UI

**Files:**
- Create: `src/app/portal/admin/links/page.tsx` (server component: gate on `link:moderate`, list all links via `links.listAll`)
- Create: `src/components/links/link-moderation.tsx` (client component: all-links table with owner column, open-destination, edit, and delete actions hitting `/api/links/[id]`)

**Interfaces:**
- Consumes: `requireActor` + `can("link:moderate")` (via `@/server/auth/permissions`); `getRepositories`; shadcn `Table`/`Button`/`Badge`. (Add `table` with `pnpm dlx shadcn@latest add table` if not present.)
- Produces: `/portal/admin/links` admin queue. Reuses the same `/api/links*` endpoints with `scope=all`; moderation authorization is enforced server-side in the repository (`listAll`/`update`/`remove` check `link:moderate`), so the UI only gates visibility.

- [ ] **Step 1: Write `src/app/portal/admin/links/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { getRepositories } from "@/db";
import { LinkModeration } from "@/components/links/link-moderation";

export const dynamic = "force-dynamic";

export default async function AdminLinksPage() {
	const actor = await requireActor();
	if (!can(actor, "link:moderate")) redirect("/portal");
	const { links } = await getRepositories();
	const allLinks = await links.listAll(actor, { limit: 50 });
	return <LinkModeration initialLinks={allLinks} />;
}
```

- [ ] **Step 2: Write `src/components/links/link-moderation.tsx`**

A client component rendering the all-links list in a shadcn `Table`: columns for slug (linking to `/l/{slug}`), destination, owner id, click count, and created date, with per-row Edit (PATCH title/destination) and Delete (DELETE) controls that call `/api/links/[id]` same-origin. Offsets/pagination use `scope=all&limit=50&offset=N`. No nested cards; one table-driven screen (minimalism).

- [ ] **Step 3: Run typecheck, lint, and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/portal/admin/links src/components/links/link-moderation.tsx
git commit -m "feat(links): add admin link moderation queue"
```

---

### Task 12: Full suite, migration check, and gated dev-Worker redeploy

**Files:**
- None created; verification + ops only.

**Interfaces:**
- Consumes: everything from Tasks 1-11.
- Produces: a green CI-equivalent local run and the surfaced (approval-gated) dev-Worker redeploy obligation.

- [ ] **Step 1: Confirm there is no schema drift**

Run: `pnpm db:generate`
Expected: drizzle-kit reports NO changes (Phase 3 added no tables/columns). If it reports changes, STOP — a schema edit slipped in; revert it (Phase 3 is contract/route/UI only).

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: PASS — includes `links.test.ts`, `crawlers.test.ts`, `links.integration.test.ts`, `handlers.test.ts`, `redirect.test.ts`, `uploads.test.ts`, `shared-parity.integration.test.ts` (now with the links block), plus all pre-existing suites.

- [ ] **Step 3: Run typecheck, lint, and build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS (OpenNext build clean).

- [ ] **Step 4: Update the shared-dev-note check input if needed**

Phase 3 touches `src/db/contract/**` and adds `src/app/internal/**` routes, which `scripts/check-shared-dev-note.ts` watches. Ensure the final PR/commit includes a shared-dev deploy note so `pnpm check:shared-dev-note` passes.
Run: `pnpm check:shared-dev-note`
Expected: PASS (or it instructs you to add the note).

- [ ] **Step 5: STOP — surface the dev-Worker redeploy obligation, do not run without approval**

Per CLAUDE.md and master-plan §15, contract + internal-route changes require redeploying the dev Worker so shared-mode developers do not break. No schema migration is needed (no schema change), so `db:migrate:dev` is NOT required for Phase 3 unless a later task added a migration. Present these commands and wait for explicit approval before running:
```bash
pnpm deploy:dev
```
If a reseed of the dev link sample is wanted (Task 9 changed seed data), also present, gated:
```bash
pnpm db:seed:dev
```

- [ ] **Step 6: Keep the knowledge graph current**

Run: `graphify update .`
Expected: AST-only refresh, no API cost (CLAUDE.md graphify rule).

---

## Self-review notes (for the implementer, not a step to execute)

**Spec coverage (Phase 3 scope, master-plan §12 + §6/§7):**
- CRUD + ownership → Task 3 (repository), Task 5 (`/api/links`), Tasks 10-11 (UI).
- Reserved/format/destination validation → Task 1 (pure helpers, reserved-slug constant), Task 3 (enforced + DB reserved-slug + duplicate-slug checks), Task 9 (seeded reserved slugs).
- `/l/[slug]` redirect + daily-stat upsert → Task 6 (route + fail-open background `recordClick`), Task 3 (`resolveForRedirect` + `recordClick` upsert into `link_daily_stats` + `click_count` bump).
- Embed/OG preview control (crawler-UA branch + `preview_title`/`preview_description`/`preview_image_key`) → Task 2 (crawler allowlist + OG HTML), Task 6 (crawler branch), Task 8 (public preview-image namespace), Task 3/4 (preview columns through repository + contract), Task 10 (owner sets preview fields + image).
- Analytics views → Task 3 (`getStats` rollup aggregation), Task 5/7 (stats endpoints), Task 10 (stats panel).
- QR export → Task 10 (`LinkQr`, client-side, not persisted — §7).
- Admin moderation → Task 3 (`listAll`/moderate update/delete with `link:moderate`), Task 11 (admin queue UI).

**Cross-cutting constraints honored:** authz in the repository on every privileged op with audit writes (§3.2/§5); D1 budget via paginated lists with backing indexes (§3.4); same-origin guard + shared proxy on `/api/links` mutations and the `/internal/links` bearer/CORS/404/`sharedDev` gate (§3.3/§4.5); fail-open analytics via `runInBackground` (§6); http/https-only destinations (open-redirect guard, §6/§10); the link preview image as the only public upload namespace (§7).

**Intentionally out of scope / deferred (not Phase 3):**
- Advanced link analytics (raw per-click event sampling, geo, bot filtering, UTM) — master-plan §11 #9; v1 keeps only the `link_daily_stats` rollup.
- Charting library for the analytics view — rendered as plain shadcn `Card`/`Table` lists; a charting dep is a later polish item, not load-bearing.
- Rate-limiting link creation and the redirect — master-plan §4.5 assigns rate limits to Phase 9 (Hardening), not Phase 3.
- Persisting QR codes to R2 — explicitly deferred (§7, YAGNI v1); QR stays client-generated.
- Shared-mode `createSharedRepositories().links` is left unavailable (Task 3 Step 6) because links shared-mode parity is exercised through the `/internal/links` handler (Task 7); wiring the HTTP-backed `SharedApiDatabaseAdapter` for links is only needed if a non-internal shared path consumes `getRepositories().links`, which Phase 3 does not.

**Type-consistency check:** repository method names (`listOwn`, `listAll`, `getById`, `create`, `update`, `remove`, `getStats`, `resolveForRedirect`, `recordClick`) are used identically in Tasks 3, 5, 6, 7, 10, 11. Contract op names (`listOwn`, `listAll`, `get`, `create`, `update`, `remove`, `stats`) match between Task 4 and their consumers in Tasks 5 and 7. The `UpdateLinkInput` shape (Task 3) matches `updateLinkInputSchema` minus `id` (Task 4), and the handler strips `id` before calling `update` in both Task 5 and Task 7. The upload `purpose` value `link_preview` and namespace `links/{linkId}/{memberId}/...` are identical across Tasks 8 and 10.

**Placeholder scan:** no "TBD"/"add error handling"/"similar to Task N" placeholders; every code step shows complete code. The two UI-glue files (Tasks 10 Step 4, 11 Step 2) are described rather than fully transcribed because they are non-load-bearing presentation with no new contract surface and their behavior is fully covered by server-side tests in Tasks 1-8; if the executor prefers, they may request the full component source, but the server contract they call is exact.
