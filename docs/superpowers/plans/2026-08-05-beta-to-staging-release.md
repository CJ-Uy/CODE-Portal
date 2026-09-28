# Beta to Staging Release Implementation Plan

> **Superseded in part, 2026-08-07.** The separate migration directory this plan
> introduced has been replaced by a single history shared by every environment. See
> `docs/superpowers/specs/2026-08-07-migration-lineage-unification-design.md`.
> The feature-flag work in tasks 1 to 5 still stands; task 1 and part of task 2 shipped
> in commits f8bd0f3 and dbbebe4.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the approved beta features to `code-nest-staged` while hard-disabling unfinished modules, preserving the current public redirect, and rehearsing a production-compatible, data-preserving D1 migration.

**Architecture:** Six fail-closed Worker vars control unfinished product surfaces at server boundaries. A release branch merges the complete beta dependency chain into staging, while staging and production use a separate migration directory that continues production's existing migration history and adds one non-destructive bridge migration.

**Tech Stack:** Next.js 16, TypeScript, React 19, Zod, Drizzle ORM, Cloudflare Workers/D1/R2, Vitest, Playwright, Wrangler 4.

## Global Constraints

- Work in `C:\Users\charl\Documents\GitHub\code nest`, not the Automated-Testing repository.
- Preserve unrelated user changes. The existing `code-nest-main` staging worktree has dirty `graphify-out` files; do not edit, reset, clean, or reuse it for integration.
- Keep `/` redirecting to `https://sites.google.com/view/ateneo-code/landing` when `FEATURE_PUBLIC_SITE=false`.
- Only literal `true` enables a feature; missing or malformed values disable it.
- Beta enables all six flags. Staging and production disable all six flags.
- Keep Links, Profile, Events & Points, Member & Access admin, pinned navigation, dashboard shortcuts, and audit log enabled.
- Keep event-admin point assignment. The `events` role must retain `event:points`, and `events.setAwards` remains the repository enforcement point.
- Disabled pages and APIs return `404`; disabled server actions fail before repository access.
- Disabled notifications create no rows.
- Never drop or rewrite an existing production short link or analytics row.
- Never copy production member/content data into staging.
- Use UI behavior for staging acceptance setup and mutation. Record exact synthetic IDs before cleanup.
- Show the exact Wrangler command and wait for approval before every remote D1 migration, reset, seed, delete, restore, or production operation.
- No production deploy or production mutation belongs to this plan.
- Run `graphify update .` after source changes.
- Avoid em dashes in code, comments, UI copy, docs, commits, and README text.

---

### Task 1: Runtime feature flags and environment configuration

**Files:**
- Create: `src/server/features.ts`
- Create: `src/server/features.test.ts`
- Modify: `src/server/env.ts`
- Modify: `src/server/cloudflare.ts`
- Modify: `src/server/env.test.ts`
- Modify: `.env.example`
- Modify: `vitest.config.mts`
- Modify: `playwright.config.ts`
- Modify: `wrangler.beta.jsonc`
- Modify: `wrangler.staging.jsonc`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: `FeatureKey`, `FeatureFlags`, `getFeatureFlags()`, and `assertFeatureEnabled(key)`.
- Produces: six boolean fields on `AppConfig`: `FEATURE_RETENTION`, `FEATURE_LIBRARY`, `FEATURE_ANNOUNCEMENTS`, `FEATURE_NOTIFICATIONS`, `FEATURE_SURVEYS`, and `FEATURE_PUBLIC_SITE`.
- Consumed by: Tasks 2 through 5.

- [ ] **Step 1: Add failing parsing and fail-closed tests**

Create `src/server/features.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { featureFlagSchema } from "./env";
import { featureFlagsFromConfig } from "./features";

describe("release feature flags", () => {
	it("enables only the literal true string", () => {
		expect(featureFlagSchema.parse("true")).toBe(true);
		expect(featureFlagSchema.parse("false")).toBe(false);
		expect(featureFlagSchema.parse("TRUE")).toBe(false);
		expect(featureFlagSchema.parse(undefined)).toBe(false);
	});

	it("maps all six config fields", () => {
		expect(
			featureFlagsFromConfig({
				FEATURE_RETENTION: true,
				FEATURE_LIBRARY: false,
				FEATURE_ANNOUNCEMENTS: true,
				FEATURE_NOTIFICATIONS: false,
				FEATURE_SURVEYS: true,
				FEATURE_PUBLIC_SITE: false,
			}),
		).toEqual({
			retention: true,
			library: false,
			announcements: true,
			notifications: false,
			surveys: true,
			publicSite: false,
		});
	});
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
pnpm test -- src/server/features.test.ts
```

Expected: FAIL because `featureFlagSchema` and `featureFlagsFromConfig` do not exist.

- [ ] **Step 3: Parse flags in the existing environment module**

In `src/server/env.ts`, export and reuse this schema:

```ts
export const featureFlagSchema = z.string().optional().transform((value) => value === "true");
```

Add these fields to `rawEnvSchema`:

```ts
FEATURE_RETENTION: featureFlagSchema,
FEATURE_LIBRARY: featureFlagSchema,
FEATURE_ANNOUNCEMENTS: featureFlagSchema,
FEATURE_NOTIFICATIONS: featureFlagSchema,
FEATURE_SURVEYS: featureFlagSchema,
FEATURE_PUBLIC_SITE: featureFlagSchema,
```

Pass all six through `getAppConfig()` using `runtimeEnvValue(...)`. Extend `getPublicEnvStatus()` with a `features` object containing the six parsed booleans. Do not expose secrets.

- [ ] **Step 4: Add the runtime feature interface**

Create `src/server/features.ts`:

```ts
import type { AppConfig } from "./env";
import { getAppConfig } from "./env";

export type FeatureKey = "retention" | "library" | "announcements" | "notifications" | "surveys" | "publicSite";
export type FeatureFlags = Record<FeatureKey, boolean>;

type FeatureConfig = Pick<
	AppConfig,
	| "FEATURE_RETENTION"
	| "FEATURE_LIBRARY"
	| "FEATURE_ANNOUNCEMENTS"
	| "FEATURE_NOTIFICATIONS"
	| "FEATURE_SURVEYS"
	| "FEATURE_PUBLIC_SITE"
>;

export function featureFlagsFromConfig(config: FeatureConfig): FeatureFlags {
	return {
		retention: config.FEATURE_RETENTION,
		library: config.FEATURE_LIBRARY,
		announcements: config.FEATURE_ANNOUNCEMENTS,
		notifications: config.FEATURE_NOTIFICATIONS,
		surveys: config.FEATURE_SURVEYS,
		publicSite: config.FEATURE_PUBLIC_SITE,
	};
}

export function getFeatureFlags(): FeatureFlags {
	return featureFlagsFromConfig(getAppConfig());
}

export function assertFeatureEnabled(key: FeatureKey, flags = getFeatureFlags()): void {
	if (!flags[key]) throw new Error("Feature unavailable.");
}
```

- [ ] **Step 5: Extend Cloudflare runtime typing**

Add the six vars as optional strings to `CloudflareRuntimeEnv` in `src/server/cloudflare.ts`:

```ts
FEATURE_RETENTION?: string;
FEATURE_LIBRARY?: string;
FEATURE_ANNOUNCEMENTS?: string;
FEATURE_NOTIFICATIONS?: string;
FEATURE_SURVEYS?: string;
FEATURE_PUBLIC_SITE?: string;
```

- [ ] **Step 6: Configure every environment explicitly**

Add all six vars under `vars`:

```jsonc
// wrangler.beta.jsonc
"FEATURE_RETENTION": "true",
"FEATURE_LIBRARY": "true",
"FEATURE_ANNOUNCEMENTS": "true",
"FEATURE_NOTIFICATIONS": "true",
"FEATURE_SURVEYS": "true",
"FEATURE_PUBLIC_SITE": "true"
```

```jsonc
// wrangler.staging.jsonc and wrangler.jsonc
"FEATURE_RETENTION": "false",
"FEATURE_LIBRARY": "false",
"FEATURE_ANNOUNCEMENTS": "false",
"FEATURE_NOTIFICATIONS": "false",
"FEATURE_SURVEYS": "false",
"FEATURE_PUBLIC_SITE": "false"
```

Add documented local examples to `.env.example`. Add all six as `"true"` to Vitest Miniflare bindings and Playwright's normal `webServer.env` so existing full-beta tests keep their current behavior.

- [ ] **Step 7: Extend the existing environment test**

In `src/server/env.test.ts`, add:

```ts
it("fails closed for missing or malformed feature flags", () => {
	expect(featureFlagSchema.parse(undefined)).toBe(false);
	expect(featureFlagSchema.parse("yes")).toBe(false);
	expect(featureFlagSchema.parse("true")).toBe(true);
});
```

- [ ] **Step 8: Run focused tests**

Run:

```powershell
pnpm test -- src/server/env.test.ts src/server/features.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the flag foundation**

```powershell
git add src/server/features.ts src/server/features.test.ts src/server/env.ts src/server/cloudflare.ts src/server/env.test.ts .env.example vitest.config.mts playwright.config.ts wrangler.beta.jsonc wrangler.staging.jsonc wrangler.jsonc
git commit -m "feat: add fail-closed release flags"
```

---

### Task 2: Feature-aware member and admin navigation

**Files:**
- Modify: `src/components/portal/nav-items.ts`
- Create: `src/components/portal/nav-items.test.ts`
- Modify: `src/components/portal/portal-shell.tsx`
- Modify: `src/app/portal/admin/nav.ts`
- Create: `src/app/portal/admin/nav.test.ts`
- Modify: `src/app/portal/layout.tsx`

**Interfaces:**
- Consumes: `FeatureFlags` and `getFeatureFlags()` from Task 1.
- Produces: `portalNavigation(flags)` and `visibleGroups(actor, flags)`.

- [ ] **Step 1: Write failing member-navigation tests**

Create `src/components/portal/nav-items.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { portalNavigation } from "./nav-items";

const disabled = {
	retention: false,
	library: false,
	announcements: false,
	notifications: false,
	surveys: false,
	publicSite: false,
};

describe("portalNavigation", () => {
	it("promotes Links into the four-slot mobile bar when Retention is disabled", () => {
		const nav = portalNavigation(disabled);
		expect(nav.primary.map((item) => item.id)).toEqual(["overview", "calendar", "links", "profile"]);
		expect(nav.secondary.map((item) => item.id)).toEqual([]);
	});

	it("keeps beta's full navigation when every module is enabled", () => {
		const nav = portalNavigation({ ...disabled, retention: true, library: true, announcements: true, notifications: true });
		expect(nav.primary.map((item) => item.id)).toEqual(["overview", "calendar", "retention", "profile"]);
		expect(nav.secondary.map((item) => item.id)).toEqual(["library", "announcements", "links", "notifications"]);
	});
});
```

- [ ] **Step 2: Write failing admin-navigation tests**

Create `src/app/portal/admin/nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/permissions";
import { visibleGroups } from "./nav";

const superActor: Actor = { memberId: "mem_admin", roles: ["super"] };
const releaseFlags = {
	retention: false,
	library: false,
	announcements: false,
	notifications: false,
	surveys: false,
	publicSite: false,
};

describe("visibleGroups", () => {
	it("hides deferred content but keeps approved admin tools", () => {
		const hrefs = visibleGroups(superActor, releaseFlags).flatMap((group) => group.pages.map((page) => page.href));
		expect(hrefs).not.toContain("/portal/admin/content/library");
		expect(hrefs).not.toContain("/portal/admin/content/announcements");
		expect(hrefs).not.toContain("/portal/admin/content/surveys");
		expect(hrefs).toContain("/portal/admin/content/links");
		expect(hrefs).toContain("/portal/admin/members/list");
		expect(hrefs).toContain("/portal/admin/system/nav-pins");
		expect(hrefs).toContain("/portal/admin/system/quick-links");
		expect(hrefs).toContain("/portal/admin/system/audit");
		expect(hrefs).toContain("/portal/admin/data/events");
		expect(hrefs).toContain("/portal/admin/system/point-types");
	});
});
```

- [ ] **Step 3: Verify both tests fail**

```powershell
pnpm test -- src/components/portal/nav-items.test.ts src/app/portal/admin/nav.test.ts
```

Expected: FAIL because both functions lack feature arguments/behavior.

- [ ] **Step 4: Build the four-slot member navigation**

In `src/components/portal/nav-items.ts`, keep static item definitions and add:

```ts
import type { FeatureFlags } from "@/server/features";

export function portalNavigation(flags: FeatureFlags): { primary: NavItem[]; secondary: NavItem[] } {
	const overview = primaryNav.find((item) => item.id === "overview")!;
	const calendar = primaryNav.find((item) => item.id === "calendar")!;
	const retention = primaryNav.find((item) => item.id === "retention")!;
	const profile = primaryNav.find((item) => item.id === "profile")!;
	const links = secondaryNav.find((item) => item.id === "links")!;
	const primary = [overview, calendar, flags.retention ? retention : links, profile];
	const secondary = secondaryNav.filter((item) => {
		if (item.id === "links") return flags.retention;
		if (item.id === "library") return flags.library;
		if (item.id === "announcements") return flags.announcements;
		if (item.id === "notifications") return flags.notifications;
		return true;
	});
	return { primary, secondary };
}
```

Modify `PortalShellProps` to include `features: FeatureFlags`. In `PortalShell`, replace direct use of `primaryNav`/`secondaryNav` with:

```ts
const { primary, secondary } = portalNavigation(features);
const sheetItems: NavItem[] = [...secondary, ...(showAdmin ? [adminNav] : [])];
const leftTabs = primary.slice(0, 2);
const rightTabs = primary.slice(2, 4);
```

Use `primary` and `secondary` in desktop loops too.

- [ ] **Step 5: Attach feature requirements to admin pages**

Add `feature?: FeatureKey` to `AdminPage`. Mark only these pages:

```ts
{ segment: "announcements", ..., feature: "announcements" },
{ segment: "library", ..., feature: "library" },
{ segment: "surveys", ..., feature: "surveys" },
```

Change visibility filtering to:

```ts
const pageVisible = (actor: Actor, flags: FeatureFlags, page: AdminPage) =>
	(!page.feature || flags[page.feature]) && (page.permission === null || can(actor, page.permission));

export function visibleGroups(actor: Actor, flags: FeatureFlags): AdminGroup[] {
	return adminGroups
		.map((group) => ({ ...group, pages: group.pages.filter((page) => pageVisible(actor, flags, page)) }))
		.filter((group) => group.pages.length > 0);
}
```

Update all `visibleGroups` callers to pass flags.

- [ ] **Step 6: Keep notifications off the server render path**

In `src/app/portal/layout.tsx`, load `const features = getFeatureFlags()`. When `features.notifications` is false, use `Promise.resolve([])` and `Promise.resolve(0)` instead of calling the notification repository. Pass `features` to `PortalShell`, pass them to `visibleGroups`, and render `bell={null}` when notifications are disabled.

- [ ] **Step 7: Run focused tests**

```powershell
pnpm test -- src/components/portal/nav-items.test.ts src/app/portal/admin/nav.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit navigation guards**

```powershell
git add src/components/portal/nav-items.ts src/components/portal/nav-items.test.ts src/components/portal/portal-shell.tsx src/app/portal/admin/nav.ts src/app/portal/admin/nav.test.ts src/app/portal/layout.tsx
git commit -m "feat: hide deferred portal navigation"
```

---

### Task 3: Remove deferred dashboard reads and suppress notification writes

**Files:**
- Modify: `src/db/repositories/overview.ts`
- Modify: `src/db/repositories/overview.integration.test.ts`
- Modify: `src/app/portal/page.tsx`
- Modify: `src/app/portal/profile/page.tsx`
- Modify: `src/db/repositories/notifications.ts`
- Modify: `src/db/repositories/notifications.integration.test.ts`

**Interfaces:**
- Consumes: `getFeatureFlags()`.
- Changes: `OverviewRepository.getSummary(actor, options?)`, where `options` is `{ now?: Date; retention?: boolean; surveys?: boolean }`.
- Changes: `notify(db, input, enabled?)`, with runtime feature state as the default.

- [ ] **Step 1: Add failing selective-overview tests**

In `src/db/repositories/overview.integration.test.ts`, add a test that calls:

```ts
const summary = await repository.getSummary(memberActor, {
	now: NOW,
	retention: false,
	surveys: false,
});
expect(summary.retention).toEqual({ points: 0, retainedAt: null, termName: null });
expect(summary.pendingSurveys).toBe(0);
expect(summary.upcomingEvents).toBe(1);
expect(summary.linkClicks).toBe(7);
```

Update existing positional `NOW` calls to `{ now: NOW }`.

- [ ] **Step 2: Add a failing notification no-op test**

In `src/db/repositories/notifications.integration.test.ts`:

```ts
it("does not materialize notifications while the feature is disabled", async () => {
	await notify(db, { memberId: "mem_nf", kind: "points_awarded", title: "Points", body: "5 points" }, false);
	expect(await db.select().from(notifications)).toHaveLength(0);
});
```

- [ ] **Step 3: Verify focused failures**

```powershell
pnpm test -- src/db/repositories/overview.integration.test.ts src/db/repositories/notifications.integration.test.ts
```

Expected: FAIL on new function signatures/behavior.

- [ ] **Step 4: Make overview reads conditional**

Change the repository interface:

```ts
export type OverviewOptions = { now?: Date; retention?: boolean; surveys?: boolean };
export type OverviewRepository = {
	getSummary(actor: Actor, options?: OverviewOptions): Promise<OverviewSummary>;
};
```

Inside `getSummary`, default `retention` and `surveys` to true for beta compatibility. Do not call `getCurrentTerm`, `retentionRecords`, `surveyAssignments`, or `surveys` when their option is false. Return the current zero objects in those cases. Keep event and link queries unchanged.

- [ ] **Step 5: Remove deferred overview UI**

In `src/app/portal/page.tsx`, call:

```ts
const features = getFeatureFlags();
repositories.overview.getSummary(actor, { retention: features.retention, surveys: features.surveys })
```

Only request announcements, library items, and retention terms when their flags are enabled. Omit Retention, Surveys, Retention path, Announcements, and Library cards when disabled. Keep Events, Links, active scanner, and quick-link behavior.

- [ ] **Step 6: Keep profile points without exposing retention status**

In `src/app/portal/profile/page.tsx`, load flags and call overview with both deferred options false. Keep the point-type breakdown. When `features.retention` is false, omit the retained/probation badge, threshold description, and `Counts toward retention` text. Display only point-type labels and totals.

- [ ] **Step 7: Centralize notification suppression**

In `src/db/repositories/notifications.ts`:

```ts
import { getFeatureFlags } from "@/server/features";

export async function notify(db: Db, input: NotifyInput, enabled = getFeatureFlags().notifications): Promise<void> {
	if (!enabled) return;
	await db.insert(notifications).values({
		id: createId("ntf"),
		memberId: input.memberId,
		kind: input.kind,
		title: input.title,
		body: input.body,
		href: input.href ?? null,
	});
}
```

No caller-level notification flags are added. The single writer stays the enforcement point.

- [ ] **Step 8: Run focused tests**

```powershell
pnpm test -- src/db/repositories/overview.integration.test.ts src/db/repositories/notifications.integration.test.ts src/db/repositories/events.integration.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit dashboard and notification behavior**

```powershell
git add src/db/repositories/overview.ts src/db/repositories/overview.integration.test.ts src/app/portal/page.tsx src/app/portal/profile/page.tsx src/db/repositories/notifications.ts src/db/repositories/notifications.integration.test.ts
git commit -m "feat: suppress deferred dashboard features"
```

---

### Task 4: Hard-disable retention, library, announcements, and notifications

**Files:**
- Create: `src/app/portal/events/layout.tsx`
- Create: `src/app/portal/library/layout.tsx`
- Create: `src/app/portal/announcements/layout.tsx`
- Create: `src/app/portal/notifications/layout.tsx`
- Create: `src/app/portal/admin/content/library/layout.tsx`
- Create: `src/app/portal/admin/content/announcements/layout.tsx`
- Modify: `src/app/portal/library/actions.ts`
- Modify: `src/app/portal/admin/content/library/actions.ts`
- Modify: `src/app/portal/announcements/actions.ts`
- Modify: `src/app/portal/admin/content/announcements/actions.ts`
- Modify: `src/app/portal/notifications/actions.ts`
- Modify: `src/app/internal/retention/route.ts`
- Modify: `src/app/internal/notifications/route.ts`

**Interfaces:**
- Consumes: `getFeatureFlags()` for layouts/routes and `assertFeatureEnabled()` for server actions.
- Produces: page/subtree `404` behavior and action rejection before repository access.

- [ ] **Step 1: Add the six subtree layouts**

Each layout uses its exact feature key. Example for Library:

```tsx
import { notFound } from "next/navigation";
import { getFeatureFlags } from "@/server/features";

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
	if (!getFeatureFlags().library) notFound();
	return children;
}
```

Use `retention` for `portal/events`, `announcements` for both announcement layouts, `notifications` for its layout, and `library` for both library layouts.

- [ ] **Step 2: Guard every deferred server action before parsing/auth/DB work**

Add the matching first statement inside every exported action:

```ts
assertFeatureEnabled("library");
```

Apply `library` to all seven member library actions and all three admin library actions. Apply `announcements` to the member read action and all three admin announcement actions. Apply `notifications` to both notification actions.

- [ ] **Step 3: Return 404 from disabled internal routes**

At the top of each exported handler in `src/app/internal/retention/route.ts` and `src/app/internal/notifications/route.ts`, before auth/proxy/repository work:

```ts
if (!getFeatureFlags().retention) return new Response("Not found", { status: 404 });
```

Use `notifications` in the notification route.

- [ ] **Step 4: Typecheck the guards**

```powershell
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit member-content guards**

```powershell
git add src/app/portal/events/layout.tsx src/app/portal/library/layout.tsx src/app/portal/announcements/layout.tsx src/app/portal/notifications/layout.tsx src/app/portal/admin/content/library/layout.tsx src/app/portal/admin/content/announcements/layout.tsx src/app/portal/library/actions.ts src/app/portal/admin/content/library/actions.ts src/app/portal/announcements/actions.ts src/app/portal/admin/content/announcements/actions.ts src/app/portal/notifications/actions.ts src/app/internal/retention/route.ts src/app/internal/notifications/route.ts
git commit -m "feat: hard-disable deferred member modules"
```

---

### Task 5: Hard-disable surveys and beta public site

**Files:**
- Create: `src/app/portal/surveys/layout.tsx`
- Create: `src/app/portal/admin/content/surveys/layout.tsx`
- Modify: `src/app/portal/admin/content/surveys/actions.ts`
- Modify: `src/app/api/surveys/submit/route.ts`
- Modify: `src/app/internal/surveys/route.ts`
- Modify: `src/app/internal/surveys/[id]/route.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/contact/page.tsx`
- Modify: `src/app/product/page.tsx`
- Modify: `src/app/product/[slug]/page.tsx`
- Modify: `src/app/projects/page.tsx`
- Modify: `src/app/services/page.tsx`
- Modify: `src/app/api/contact/route.ts`
- Modify: `src/app/api/articles/[slug]/feedback/route.ts`

**Interfaces:**
- Consumes: Task 1 flags.
- Preserves: `src/app/[slug]/route.ts` short-link redirects and `src/app/events/[code]/route.ts` event sharing.

- [ ] **Step 1: Gate member/admin survey subtrees**

Create both survey layouts using the Task 4 layout pattern and `getFeatureFlags().surveys`.

- [ ] **Step 2: Guard survey actions and route handlers**

Call `assertFeatureEnabled("surveys")` before work in `createSurveyAction` and `sampleSurveyAction`. In the public/internal survey route handlers, return:

```ts
if (!getFeatureFlags().surveys) return new Response("Not found", { status: 404 });
```

Do this before same-origin checks, auth, parsing, proxying, or repository access.

- [ ] **Step 3: Preserve the current root redirect**

Refactor `src/app/page.tsx` so the existing beta homepage JSX moves into `PublicHome`. Make the route dynamic and select at request time:

```tsx
import { redirect } from "next/navigation";
import { getFeatureFlags } from "@/server/features";

const LANDING_PAGE_URL = "https://sites.google.com/view/ateneo-code/landing";
export const dynamic = "force-dynamic";

export default function Home() {
	if (!getFeatureFlags().publicSite) redirect(LANDING_PAGE_URL);
	return <PublicHome />;
}
```

Do not modify `src/app/[slug]/route.ts`; bare-root short links must remain live.

- [ ] **Step 4: Return 404 from beta-only public pages**

At the start of each page component for Contact, Product index/detail, Projects, and Services:

```ts
if (!getFeatureFlags().publicSite) notFound();
```

- [ ] **Step 5: Return 404 from beta-only public APIs**

At the start of Contact POST and Article Feedback POST:

```ts
if (!getFeatureFlags().publicSite) return new Response("Not found", { status: 404 });
```

- [ ] **Step 6: Verify type safety and the production build**

```powershell
pnpm typecheck
pnpm build
```

Expected: both PASS.

- [ ] **Step 7: Commit survey/public guards**

```powershell
git add src/app/portal/surveys/layout.tsx src/app/portal/admin/content/surveys/layout.tsx src/app/portal/admin/content/surveys/actions.ts src/app/api/surveys/submit/route.ts src/app/internal/surveys/route.ts 'src/app/internal/surveys/[id]/route.ts' src/app/page.tsx src/app/contact/page.tsx src/app/product/page.tsx 'src/app/product/[slug]/page.tsx' src/app/projects/page.tsx src/app/services/page.tsx src/app/api/contact/route.ts 'src/app/api/articles/[slug]/feedback/route.ts'
git commit -m "feat: defer surveys and public relaunch"
```

---

### Task 6: Production-compatible release migration track

**Files:**
- Create: `drizzle/release-migrations/0000_young_bullseye.sql`
- Create: `drizzle/release-migrations/0001_member_portal_links.sql`
- Create: `drizzle/release-migrations/0002_link_workspace_fields.sql`
- Create: `drizzle/release-migrations/0003_admin_members_nav.sql`
- Create: `drizzle/release-migrations/0004_beta_release_bridge.sql`
- Modify: `wrangler.staging.jsonc`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Consumes: production's recorded migration names and current schema.
- Produces: a release migration directory shared only by staging/production.
- Preserves: beta's existing `drizzle/migrations` and beta D1 history.

- [ ] **Step 1: Copy the four production-lineage migrations exactly**

Use `git show staging:<path>` as the read source, then create the four files with `apply_patch`. Do not use shell redirection to write them. Verify hashes against the staging blobs:

```powershell
git show staging:drizzle/migrations/0000_young_bullseye.sql | git hash-object --stdin
git show staging:drizzle/migrations/0001_member_portal_links.sql | git hash-object --stdin
git show staging:drizzle/migrations/0002_link_workspace_fields.sql | git hash-object --stdin
git show staging:drizzle/migrations/0003_admin_members_nav.sql | git hash-object --stdin
git hash-object drizzle/release-migrations/0000_young_bullseye.sql
git hash-object drizzle/release-migrations/0001_member_portal_links.sql
git hash-object drizzle/release-migrations/0002_link_workspace_fields.sql
git hash-object drizzle/release-migrations/0003_admin_members_nav.sql
```

Expected: each source/destination hash pair matches.

- [ ] **Step 2: Create the additive bridge migration**

Create `0004_beta_release_bridge.sql`. It must contain the final schemas directly, not beta's create-then-drop sequence. Required statements:

```sql
CREATE TABLE `quick_links` (
  `id` text PRIMARY KEY NOT NULL,
  `label` text NOT NULL,
  `url` text NOT NULL,
  `position` integer NOT NULL,
  `created_by` text NOT NULL REFERENCES `members`(`id`) ON DELETE cascade,
  `created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE INDEX `quick_links_position_idx` ON `quick_links` (`position`);

CREATE TABLE `term_member_roster` (
  `term_id` text NOT NULL REFERENCES `terms`(`id`) ON DELETE cascade,
  `email` text NOT NULL,
  `member_id` text REFERENCES `members`(`id`) ON DELETE set null,
  `added_by` text NOT NULL REFERENCES `members`(`id`) ON DELETE cascade,
  `added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  PRIMARY KEY (`term_id`, `email`)
);
CREATE INDEX `term_member_roster_term_id_idx` ON `term_member_roster` (`term_id`);
CREATE INDEX `term_member_roster_email_idx` ON `term_member_roster` (`email`);

CREATE TABLE `rate_limit_counters` (
  `bucket_key` text NOT NULL,
  `window_start` integer NOT NULL,
  `count` integer DEFAULT 0 NOT NULL,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  PRIMARY KEY (`bucket_key`, `window_start`)
);
CREATE INDEX `rate_limit_counters_window_start_idx` ON `rate_limit_counters` (`window_start`);

CREATE TABLE `point_types` (
  `id` text PRIMARY KEY NOT NULL,
  `key` text NOT NULL UNIQUE,
  `label` text NOT NULL,
  `milestones_json` text DEFAULT '[]' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `position` integer DEFAULT 0 NOT NULL,
  `updated_by` text REFERENCES `members`(`id`) ON DELETE set null,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
INSERT INTO `point_types` (`id`, `key`, `label`, `milestones_json`, `active`, `position`)
VALUES ('pt_retention', 'retention', 'Retention', '[]', 1, 0);

CREATE TABLE `retention_records` (
  `id` text PRIMARY KEY NOT NULL,
  `member_id` text NOT NULL REFERENCES `members`(`id`) ON DELETE cascade,
  `term_id` text NOT NULL REFERENCES `terms`(`id`) ON DELETE cascade,
  `event_id` text REFERENCES `crs_events`(`id`) ON DELETE set null,
  `point_type_id` text DEFAULT 'pt_retention' NOT NULL,
  `points` integer,
  `reason` text NOT NULL,
  `source` text DEFAULT 'manual' NOT NULL,
  `recorded_by` text NOT NULL REFERENCES `members`(`id`) ON DELETE cascade,
  `recorded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE INDEX `retention_records_member_term_idx` ON `retention_records` (`member_id`, `term_id`);
CREATE INDEX `retention_records_term_id_idx` ON `retention_records` (`term_id`);
CREATE INDEX `retention_records_event_id_idx` ON `retention_records` (`event_id`);

INSERT INTO `retention_records`
  (`id`, `member_id`, `term_id`, `event_id`, `point_type_id`, `points`, `reason`, `source`, `recorded_by`, `recorded_at`)
SELECT
  `id`, `member_id`, `term_id`, `event_id`, 'pt_retention', `points`, `reason`,
  CASE WHEN `event_id` IS NULL THEN 'manual' ELSE 'event_attendance' END,
  `awarded_by`, `awarded_at`
FROM `point_awards`;

CREATE UNIQUE INDEX `retention_records_event_member_type_idx`
ON `retention_records` (`event_id`, `member_id`, `point_type_id`)
WHERE `source` = 'event_attendance';

CREATE TABLE `event_staff` (
  `event_id` text NOT NULL REFERENCES `crs_events`(`id`) ON DELETE cascade,
  `member_id` text NOT NULL REFERENCES `members`(`id`) ON DELETE cascade,
  `role` text NOT NULL CHECK (`role` in ('admin', 'scanner')),
  `added_by` text REFERENCES `members`(`id`) ON DELETE set null,
  `added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  PRIMARY KEY (`event_id`, `member_id`)
);
CREATE INDEX `event_staff_member_id_idx` ON `event_staff` (`member_id`);

CREATE TABLE `event_invites` (
  `event_id` text NOT NULL REFERENCES `crs_events`(`id`) ON DELETE cascade,
  `member_id` text NOT NULL REFERENCES `members`(`id`) ON DELETE cascade,
  `invited_by` text REFERENCES `members`(`id`) ON DELETE set null,
  `invited_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
  PRIMARY KEY (`event_id`, `member_id`)
);
CREATE INDEX `event_invites_member_invited_idx` ON `event_invites` (`member_id`, `invited_at`);

CREATE TABLE `event_type_rules` (
  `type` text PRIMARY KEY NOT NULL,
  `required_permission` text,
  `label` text DEFAULT '' NOT NULL,
  `colour` text DEFAULT 'slate' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `position` integer DEFAULT 0 NOT NULL,
  `updated_by` text REFERENCES `members`(`id`) ON DELETE set null,
  `updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
INSERT INTO `event_type_rules` (`type`, `required_permission`, `label`, `colour`, `active`, `position`) VALUES
  ('official', 'event:create_restricted', 'Official', 'primary', 1, 0),
  ('casual', NULL, 'Casual', 'emerald', 1, 1),
  ('birthday', NULL, 'Birthday', 'accent', 1, 2);

CREATE TABLE `event_point_awards` (
  `event_id` text NOT NULL REFERENCES `crs_events`(`id`) ON DELETE cascade,
  `point_type_id` text NOT NULL REFERENCES `point_types`(`id`),
  `points` integer NOT NULL,
  PRIMARY KEY (`event_id`, `point_type_id`)
);

CREATE TABLE `link_hourly_stats` (
  `link_id` text NOT NULL REFERENCES `short_links`(`id`) ON DELETE cascade,
  `hour` text NOT NULL,
  `referrer_bucket` text NOT NULL,
  `device_bucket` text NOT NULL,
  `count` integer DEFAULT 0 NOT NULL,
  PRIMARY KEY (`link_id`, `hour`, `referrer_bucket`, `device_bucket`)
);
CREATE INDEX `link_hourly_stats_link_hour_idx` ON `link_hourly_stats` (`link_id`, `hour`);

ALTER TABLE `crs_events` ADD COLUMN `deleted_at` integer;
ALTER TABLE `crs_events` ADD COLUMN `grace_minutes` integer;
ALTER TABLE `crs_events` ADD COLUMN `rsvp_form_json` text DEFAULT '[]' NOT NULL;
ALTER TABLE `crs_events` ADD COLUMN `rsvp_responses_public` integer DEFAULT 0 NOT NULL;
ALTER TABLE `crs_events` ADD COLUMN `all_day` integer DEFAULT 0 NOT NULL;
ALTER TABLE `crs_events` ADD COLUMN `read_only` integer DEFAULT 0 NOT NULL;
ALTER TABLE `crs_events` ADD COLUMN `public_code` text;
ALTER TABLE `event_rsvps` ADD COLUMN `answers_json` text DEFAULT '{}' NOT NULL;
ALTER TABLE `audit_logs` ADD COLUMN `target_member_id` text REFERENCES `members`(`id`) ON DELETE set null;

CREATE INDEX `crs_events_ends_at_idx` ON `crs_events` (`ends_at`);
UPDATE `crs_events`
SET `public_code` = upper(substr(hex(randomblob(8)), 1, 8))
WHERE `public_code` IS NULL;

CREATE UNIQUE INDEX `crs_events_public_code_idx` ON `crs_events` (`public_code`);
CREATE INDEX `audit_logs_target_member_created_idx` ON `audit_logs` (`target_member_id`, `created_at`);
CREATE INDEX `audit_logs_action_created_idx` ON `audit_logs` (`action`, `created_at`);
```

Add `--> statement-breakpoint` between statements for Wrangler.

- [ ] **Step 3: Point only staged/prod configs at the release track**

Add this to the `DB` binding in `wrangler.staging.jsonc` and `wrangler.jsonc`:

```jsonc
"migrations_dir": "drizzle/release-migrations"
```

Do not change `wrangler.beta.jsonc`.

- [ ] **Step 4: Verify no destructive bridge SQL**

```powershell
rg -n "DROP TABLE|DROP COLUMN|DELETE FROM|UPDATE short_links|UPDATE link_daily_stats" drizzle/release-migrations/0004_beta_release_bridge.sql
```

Expected: no matches.

- [ ] **Step 5: Commit the release migration track**

```powershell
git add drizzle/release-migrations wrangler.staging.jsonc wrangler.jsonc
git commit -m "feat: add production-safe release migrations"
```

---

### Task 7: Runnable migration preservation check

**Files:**
- Create: `scripts/check-release-migrations.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: all SQL in `drizzle/release-migrations`.
- Produces: `pnpm check:release-migrations`, a zero-network preservation check.

- [ ] **Step 1: Create the migration check script**

Use `node:fs`, `node:os`, `node:path`, `node:assert/strict`, and the already-installed `better-sqlite3`. The script must:

1. Create a temporary SQLite database with `mkdtempSync`.
2. Apply release migrations `0000` through `0003` with `db.exec(sql.replaceAll("--> statement-breakpoint", ""))`.
3. Insert two synthetic members, one term, one event, one `point_awards` row, two short links, three daily-stat rows, and one audit row.
4. Record counts and destinations.
5. Apply `0004_beta_release_bridge.sql`.
6. Assert unchanged member, short-link, daily-stat, and audit counts.
7. Assert both link destinations are byte-for-byte unchanged.
8. Assert the old point award exists in `retention_records` as `pt_retention`.
9. Assert `link_hourly_stats`, `quick_links`, `event_type_rules`, `point_types`, `event_point_awards`, `event_staff`, and `event_invites` exist.
10. Assert `crs_events` has `deleted_at`, `grace_minutes`, `rsvp_form_json`, `rsvp_responses_public`, `all_day`, `read_only`, and `public_code`.
11. Close the DB and remove only the created temp directory in `finally`.

Core assertion shape:

```js
assert.equal(db.prepare("SELECT count(*) count FROM short_links").get().count, 2);
assert.equal(db.prepare("SELECT count(*) count FROM link_daily_stats").get().count, 3);
assert.deepEqual(
	db.prepare("SELECT slug, destination_url FROM short_links ORDER BY slug").all(),
	[
		{ slug: "release-a", destination_url: "https://example.com/a" },
		{ slug: "release-b", destination_url: "https://example.com/b" },
	],
);
assert.deepEqual(
	db.prepare("SELECT id, point_type_id, points FROM retention_records WHERE id = 'award_release'").get(),
	{ id: "award_release", point_type_id: "pt_retention", points: 5 },
);
```

- [ ] **Step 2: Add the package script**

```json
"check:release-migrations": "node scripts/check-release-migrations.mjs"
```

- [ ] **Step 3: Run the preservation check**

```powershell
pnpm check:release-migrations
```

Expected: exit 0 and a concise success line reporting preserved synthetic link/stat counts.

- [ ] **Step 4: Commit the check**

```powershell
git add scripts/check-release-migrations.mjs package.json
git commit -m "test: verify release migration preservation"
```

---

### Task 8: Automated release-guard browser checks

**Files:**
- Create: `playwright.release.config.ts`
- Create: `e2e/release-guards.spec.ts`

**Interfaces:**
- Consumes: local E2E auth bypass and all flags from Tasks 1 through 5.
- Produces: desktop/iPhone/Android hard-disable verification.

- [ ] **Step 1: Add a release-flags Playwright config**

Copy the current config to port `3101`, set all six feature vars to `"false"`, and define:

```ts
projects: [
	{ name: "desktop", use: { ...devices["Desktop Chrome"] } },
	{ name: "iphone", use: { ...devices["iPhone 15"] } },
	{ name: "android", use: { ...devices["Pixel 7"] } },
],
```

Keep one worker, no retries, and state-based assertions.

- [ ] **Step 2: Add hard-disable route tests**

Create `e2e/release-guards.spec.ts`. Sign in as member/admin using the existing fixture. For every route below, assert the navigation response status is `404`:

```ts
const memberRoutes = [
	"/portal/events",
	"/portal/library",
	"/portal/library/lists",
	"/portal/announcements",
	"/portal/notifications",
	"/portal/surveys/missing",
];

const adminRoutes = [
	"/portal/admin/content/library",
	"/portal/admin/content/announcements",
	"/portal/admin/content/surveys",
];

const publicRoutes = ["/contact", "/product", "/projects", "/services"];
```

Assert member navigation omits Retention, Library, Announcements, Notifications, and includes Link shortener. Assert admin navigation omits the three deferred content modules and includes Member List, Roles & Access, Short Links, Pinned Nav Links, Dashboard Shortcuts, Activity Log, Events, and Point Types.

- [ ] **Step 3: Add root, short-link, and API checks**

Use Playwright request context with `maxRedirects: 0` to assert `/` returns a redirect whose `location` equals `https://sites.google.com/view/ateneo-code/landing`. Assert the seeded `/welcome` short link still redirects to `https://example.com/code`, proving the public-site flag does not intercept `src/app/[slug]/route.ts`. Assert POST requests to `/api/surveys/submit`, `/api/contact`, and `/api/articles/missing/feedback` return `404` before validation.

- [ ] **Step 4: Run all three release projects**

```powershell
pnpm exec playwright test --config playwright.release.config.ts
```

Expected: PASS on desktop, iPhone, and Android.

- [ ] **Step 5: Commit browser guards**

```powershell
git add playwright.release.config.ts e2e/release-guards.spec.ts
git commit -m "test: cover staged feature guards"
```

---

### Task 9: Full local verification and graph refresh

**Files:**
- Modify generated files under: `graphify-out/`

**Interfaces:**
- Consumes: Tasks 1 through 8.
- Produces: locally verified beta release candidate.

- [ ] **Step 1: Run smallest-to-largest checks**

```powershell
pnpm check:release-migrations
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright test
pnpm exec playwright test --config playwright.release.config.ts
pnpm build
```

Expected: every command exits 0. Do not continue on failure.

- [ ] **Step 2: Confirm event-admin point authority**

```powershell
pnpm test -- src/db/repositories/events.integration.test.ts src/server/auth/permissions.test.ts
rg -n 'events: \["event:moderate", "event:points"' src/server/auth/permissions.ts
rg -n 'can\(actor, "event:points"\)' src/db/repositories/events.ts
```

Expected: tests PASS; both guards remain present.

- [ ] **Step 3: Refresh the knowledge graph**

```powershell
graphify update .
```

- [ ] **Step 4: Review the exact source diff**

```powershell
git status --short
git diff --check
git diff --stat staging...HEAD
```

Expected: no untracked runtime secrets, `.auth`, local DB, Worker artifacts, or test credentials.

- [ ] **Step 5: Commit only the graph refresh if it changed**

```powershell
git add graphify-out
git commit -m "chore: refresh release knowledge graph"
```

Skip this commit only when `graphify update .` produces no diff.

---

### Task 10: Build the isolated staging integration branch

**Files:**
- Worktree: `.worktrees/release-2026-08-05-staging/`
- Branch: `release/2026-08-05-staging`

**Interfaces:**
- Consumes: verified `beta` and current `staging` refs.
- Produces: one merge candidate containing both histories.

- [ ] **Step 1: Invoke required worktree skill before execution**

Use `superpowers:using-git-worktrees`. Do not use the dirty `code-nest-main` staging worktree.

- [ ] **Step 2: Verify source refs and working tree**

```powershell
git status --short
git rev-parse beta
git rev-parse staging
git worktree list
```

Expected: beta clean; record both hashes in execution notes.

- [ ] **Step 3: Create integration worktree from staging**

```powershell
git worktree add .worktrees/release-2026-08-05-staging -b release/2026-08-05-staging staging
```

- [ ] **Step 4: Merge complete beta history**

From the new worktree:

```powershell
git merge --no-ff beta -m "merge: prepare beta staging release"
```

Resolve conflicts by preserving:

- staging Worker identity/domain/bindings from `wrangler.staging.jsonc`;
- all six staging flags as false;
- all six beta flags as true in `wrangler.beta.jsonc`;
- release migration directory for staged/prod configs;
- beta source implementation and tests;
- current `/` redirect behavior when the public flag is false.

Never resolve by accepting all of one side for `package.json`, Wrangler configs, migrations, auth, permissions, or link repository files.

- [ ] **Step 5: Re-run full checks in integration worktree**

```powershell
pnpm install --frozen-lockfile
pnpm check:release-migrations
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright test --config playwright.release.config.ts
pnpm build
```

Expected: all PASS.

- [ ] **Step 6: Stop before remote branch mutation**

Show the merge hash and verification results. Obtain approval before pushing the release branch, opening/merging a PR into `staging`, or deploying its Worker.

---

### Task 11: Approved staged D1 migration and Worker deployment

**Files:**
- No source edits expected.
- Record outputs for the staging report.

**Interfaces:**
- Consumes: exact verified merge commit from Task 10.
- Produces: migrated staged D1 and deployed `code-nest-staged` Worker.

- [ ] **Step 1: Read-only preflight**

```powershell
pnpm exec wrangler d1 migrations list DB --config wrangler.staging.jsonc --remote
pnpm exec wrangler d1 execute DB --config wrangler.staging.jsonc --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name; SELECT * FROM d1_migrations ORDER BY id;"
```

Expected before first release migration: staged DB contains only Cloudflare system tables and an empty migration list. If this changed, stop and redesign against observed state.

- [ ] **Step 2: Record staged Time Travel bookmark**

```powershell
pnpm exec wrangler d1 time-travel info DB --config wrangler.staging.jsonc --json
```

Save the returned bookmark in private execution notes and later in the technical report. Do not restore anything.

- [ ] **Step 3: Request explicit migration approval**

Show this exact command and wait:

```powershell
pnpm exec wrangler d1 migrations apply DB --config wrangler.staging.jsonc --remote
```

- [ ] **Step 4: Apply migration once after approval**

Run the approved command exactly once. Do not retry an ambiguous result. On failure, inspect migration history and schema before deciding anything.

- [ ] **Step 5: Verify staged schema and preservation baseline**

```powershell
pnpm exec wrangler d1 migrations list DB --config wrangler.staging.jsonc --remote
pnpm exec wrangler d1 execute DB --config wrangler.staging.jsonc --remote --command "SELECT COUNT(*) AS links FROM short_links; SELECT COUNT(*) AS daily_stats FROM link_daily_stats; SELECT name FROM sqlite_master WHERE type='table' AND name IN ('quick_links','link_hourly_stats','event_type_rules','point_types','event_point_awards','event_staff','event_invites') ORDER BY name;"
```

Expected: no pending migrations; all seven required tables exist. Staging link/stat counts remain zero until synthetic UI setup.

- [ ] **Step 6: Request explicit staged deploy approval**

Show this exact command and exact Git commit:

```powershell
npx --yes node@22 ./node_modules/wrangler/bin/wrangler.js deploy --no-x-autoconfig --config wrangler.staging.jsonc
```

- [ ] **Step 7: Deploy once after approval**

Run the approved command from the verified integration worktree. Record returned Worker version and deployment URL. Do not deploy beta or production configs.

- [ ] **Step 8: Perform read-only health checks first**

Verify `https://staged.ateneocode.org/` redirects to the current Google Sites landing URL, existing auth entry points respond, and disabled public/member routes return `404` before creating any data.

---

### Task 12: Staging acceptance, cleanup, and boss-ready report

**Files:**
- Create after testing: `docs/releases/2026-08-05-staging-release-report.md`

**Interfaces:**
- Consumes: deployed staging URL, synthetic run IDs, Playwright/browser artifacts, migration/deployment outputs.
- Produces: release decision and non-technical feature report.

- [ ] **Step 1: Create one run ID and record exact synthetic handles**

Use `release-20260805-<short-random>` in every synthetic link/event label. Record member IDs, link IDs/slugs, event IDs/codes, attendance member IDs, and point record IDs as soon as observed.

- [ ] **Step 2: Run blocking short-link checks first**

On desktop, iPhone, and Android:

- create one run-owned link;
- edit title, destination, tags, and QR style;
- open analytics and QR export;
- visit its bare slug and verify exact destination;
- verify click total plus daily/hourly stats;
- confirm a non-owner cannot edit/delete it;
- confirm link moderator can access moderation;
- delete only the run-owned link after recording final evidence.

Any short-link failure blocks remaining promotion work.

- [ ] **Step 3: Run profile checks**

Verify view/edit, validation errors, persisted name/nickname/pronouns/batch/birthday visibility, generic point breakdown, and no retention status/progress UI.

- [ ] **Step 4: Run exact Events & Points journey**

Create one run-owned event; configure signup questions; approve it; RSVP as test member; assign at least two point types as Event Admin; scan the exact member; verify duplicate response, lateness state, awards, admin event/member/scan/ledger pages, audit rows, export; reverse the exact scan; verify attendance-source points are removed.

- [ ] **Step 5: Verify included admin tools**

Verify member search, bulk synthetic invite, role assignment boundaries, pinned navigation, dashboard shortcuts, and Activity Log. Remove only run-owned pin/shortcut/invite state when supported.

- [ ] **Step 6: Verify all deferred surfaces**

Repeat release-guard route and navigation checks against deployed staging. Query notification count before and after event/point activity; expected delta is zero.

- [ ] **Step 7: Write the report with observed results only**

Create `docs/releases/2026-08-05-staging-release-report.md` with:

1. Executive decision: pass, fail, or interrupted.
2. “What this update adds” using the approved plain-language list from the design spec.
3. “Planned future features”: retention, library, announcements, notifications, surveys, new public site.
4. “Intentionally unchanged”: root redirect and production-first short-link priority.
5. Test matrix by device and feature.
6. Short-link preservation evidence and synthetic results.
7. Exact commit, Worker version, D1 migrations, bookmark, artifacts, known issues, and cleanup.
8. Explicit statement: production was not changed.

- [ ] **Step 8: Commit report and test-only cleanup**

```powershell
git add docs/releases/2026-08-05-staging-release-report.md
git commit -m "docs: report staged beta release"
```

- [ ] **Step 9: Stop before production**

Present report. Do not migrate or deploy production. Production requires a separate approval, fresh read-only row counts, fresh D1 bookmark, and its own execution plan/checkpoint.
