# Admin Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `/portal/admin` into 4 nested, plain-language route groups with a breadcrumb, add a member-first Roles & Access page and bulk member add, and put in-context help on every admin page.

**Architecture:** Next.js App Router route groups (`admin/<group>/<page>`) driven by a single typed route registry (`admin/nav.ts`) that feeds nav, dashboard tiles, breadcrumb, and page guards. Roles/bulk mutations go through server actions that use D1 `db.batch()` (D1 has no interactive transactions) for atomicity, with a server-computed diff and optimistic concurrency.

**Tech Stack:** Next.js (App Router, server actions), Drizzle ORM on Cloudflare D1, Auth.js v5 (database sessions), Zod, shadcn/ui, Vitest, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-04-admin-console-redesign-design.md` (normative). Review log: `…-review-log.md`.

## Global Constraints

- Keep `/` public/reader-first; member workspace under `/portal`. Drizzle schema in `src/db/schema.ts` is the only schema source.
- **No schema migration** is expected for this plan (roles/member_roles/term_member_roster all exist). If planning uncovers a needed column, STOP and surface the exact `pnpm exec wrangler` command; do not run any D1 reset/migrate/seed without explicit approval.
- D1 budget: ≤100 bound params / ≤100 KB per statement; use `db.batch([...])` for multi-statement atomic writes (single round trip, implicit transaction, rolls back on any failure).
- Server-side authorization is authoritative; client disabling is UX only. Every mutation server action calls `assertSameOrigin` (`src/server/http/origin.ts`).
- Roles read/write and member search are `role:assign`-gated (see spec §2). Bulk add is `roster:manage`-gated (matches existing roster actions).
- Plain-language names are fixed by the spec rename map. Do not invent alternatives.
- **Codex owns Shortlinks on the tree.** Phase B moves `admin/links` → `content/links`; do not start Phase B until Shortlinks is merged, or resolve the conflict in B.
- Commit after every green step. TDD: failing test → run (fail) → implement → run (pass) → commit.
- Do not run builds/typechecks against the shared dev Worker or deploy without explicit approval.

---

## File Structure (decomposition)

**New:**
- `src/app/portal/admin/nav.ts` — typed route registry: groups, pages, labels, hrefs, required permission. Single source consumed by layout nav, dashboard, breadcrumb, page guards.
- `src/components/portal/breadcrumb.tsx` — generic presentational `<Breadcrumb>`.
- `src/components/portal/admin-intro.tsx` — `<AdminIntro>` help callout.
- `src/app/portal/admin/<group>/layout.tsx` ×4 — group sub-nav + intro + `notFound()` when no visible child.
- `src/app/portal/admin/<group>/page.tsx` ×4 — group index (tiles).
- `src/app/portal/admin/members/roles/page.tsx` + `actions.ts` — Roles & Access.
- `src/db/repositories/roles.ts` — assignable roles, member role keys, atomic save. New repo.
- `src/lib/roster-emails.ts` — shared email parser/normalizer (single + bulk).
- Tests alongside: `src/db/repositories/roles.test.ts`, `src/lib/roster-emails.test.ts`, `src/db/repositories/members.search.test.ts`, `e2e/admin-nav.spec.ts`.

**Moved (git mv, Phase B):** the 11 admin pages into group folders (see Task B1).

**Modified:** `src/components/portal/portal-shell.tsx` (breadcrumb + `getPageHeading`), `src/app/portal/admin/layout.tsx` + `page.tsx` (grouped nav/tiles from registry), every `admin/*/actions.ts` (`revalidatePath` targets), `src/db/repositories/index.ts` + members repo (wire `roles` repo + `members.search`), `src/app/portal/admin/members/list/page.tsx` (bulk add), `e2e/retention-record.spec.ts` (new paths).

---

## PHASE A — Shared infra

### Task A1: Route registry (`nav.ts`)

**Files:**
- Create: `src/app/portal/admin/nav.ts`
- Test: `src/app/portal/admin/nav.test.ts`

**Interfaces:**
- Produces: `type AdminPermission = PermissionAction | null;` (null = always-visible, e.g. Activity Log). `type AdminPage = { segment: string; label: string; href: string; description: string; permission: AdminPermission };` `type AdminGroup = { segment: string; label: string; href: string; pages: AdminPage[] };` `export const adminGroups: AdminGroup[];` `export function visibleGroups(actor: Actor): AdminGroup[];` (filters pages by `permission == null || can(actor, permission)`, drops empty groups). `export function crumbFor(pathname: string): { label: string; href?: string }[];`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/portal/admin/nav.test.ts
import { describe, it, expect } from "vitest";
import { adminGroups, visibleGroups, crumbFor } from "./nav";
import type { Actor } from "@/server/auth/permissions";

const superActor: Actor = { memberId: "m1", roles: ["super"] };
const linkOnly: Actor = { memberId: "m2", roles: ["link"] };

describe("admin nav registry", () => {
  it("has 4 groups with the spec's routes", () => {
    expect(adminGroups.map((g) => g.segment)).toEqual(["members", "content", "data", "system"]);
    const members = adminGroups.find((g) => g.segment === "members")!;
    expect(members.pages.map((p) => p.href)).toEqual([
      "/portal/admin/members/list",
      "/portal/admin/members/roles",
    ]);
  });
  it("super sees every group; link role sees only Short Links + always-visible pages", () => {
    expect(visibleGroups(superActor).length).toBe(4);
    const visible = visibleGroups(linkOnly).flatMap((g) => g.pages.map((p) => p.href));
    expect(visible).toContain("/portal/admin/content/links");
    expect(visible).toContain("/portal/admin/system/audit"); // permission null → always visible
    expect(visible).not.toContain("/portal/admin/members/roles");
  });
  it("builds a breadcrumb trail with clickable ancestors", () => {
    expect(crumbFor("/portal/admin/members/roles")).toEqual([
      { label: "Admin", href: "/portal/admin" },
      { label: "Members & Access", href: "/portal/admin/members" },
      { label: "Roles & Access" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/portal/admin/nav.test.ts`
Expected: FAIL (module `./nav` not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/portal/admin/nav.ts
import type { Actor, PermissionAction } from "@/server/auth/permissions";
import { can } from "@/server/auth/permissions";

export type AdminPermission = PermissionAction | null;
export type AdminPage = { segment: string; label: string; href: string; description: string; permission: AdminPermission };
export type AdminGroup = { segment: string; label: string; href: string; pages: AdminPage[] };

const G = (segment: string, label: string, pages: Omit<AdminPage, "href">[]): AdminGroup => ({
  segment,
  label,
  href: `/portal/admin/${segment}`,
  pages: pages.map((p) => ({ ...p, href: `/portal/admin/${segment}/${p.segment}` })),
});

export const adminGroups: AdminGroup[] = [
  G("members", "Members & Access", [
    { segment: "list", label: "Member List", description: "Official CODE members this term; adding an email lets that person sign in.", permission: "roster:manage" },
    { segment: "roles", label: "Roles & Access", description: "Grant admin roles to members.", permission: "role:assign" },
  ]),
  G("content", "Content", [
    { segment: "announcements", label: "Announcements", description: "Org posts.", permission: "announcement:manage" },
    { segment: "library", label: "Library", description: "Articles & case studies.", permission: "library:manage" },
    { segment: "surveys", label: "Surveys", description: "Sampling & questions.", permission: "survey:configure" },
    { segment: "submissions", label: "Public Submissions", description: "Contact inquiries + article feedback from the public site.", permission: null },
    { segment: "links", label: "Short Links", description: "Moderate member short links.", permission: "link:moderate" },
  ]),
  G("data", "Data", [
    { segment: "retention", label: "Log Retention", description: "Record retention/attendance records.", permission: "retention:record" },
    { segment: "exports", label: "Data Exports", description: "CSV exports of retention data.", permission: "retention:record" },
  ]),
  G("system", "System", [
    { segment: "nav-pins", label: "Pinned Nav Links", description: "Links shown in every member's top nav.", permission: "nav:configure" },
    { segment: "quick-links", label: "Dashboard Shortcuts", description: "Resources in the dashboard Quick Links widget.", permission: "nav:configure" },
    { segment: "audit", label: "Activity Log", description: "Recorded admin actions.", permission: null },
  ]),
];

const pageVisible = (actor: Actor, p: AdminPage) => p.permission === null || can(actor, p.permission);

export function visibleGroups(actor: Actor): AdminGroup[] {
  return adminGroups
    .map((g) => ({ ...g, pages: g.pages.filter((p) => pageVisible(actor, p)) }))
    .filter((g) => g.pages.length > 0);
}

export function crumbFor(pathname: string): { label: string; href?: string }[] {
  const trail: { label: string; href?: string }[] = [{ label: "Admin", href: "/portal/admin" }];
  const clean = pathname.split("?")[0] ?? "";
  const group = adminGroups.find((g) => clean.startsWith(`${g.href}/`) || clean === g.href);
  if (!group) return trail;
  const onGroupIndex = clean === group.href;
  trail.push({ label: group.label, href: onGroupIndex ? undefined : group.href });
  const page = group.pages.find((p) => clean === p.href || clean.startsWith(`${p.href}/`));
  if (page) trail.push({ label: page.label, href: clean === page.href ? undefined : page.href });
  return trail;
}
```

Note: confirm `roster:manage`, `role:assign`, `announcement:manage`, `library:manage`, `survey:configure`, `link:moderate`, `retention:record`, `nav:configure` all exist in `src/server/auth/permissions.ts` `permissionActions` (they do as of writing). Member List uses `roster:manage` (matches the existing roster page guard).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/portal/admin/nav.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/portal/admin/nav.ts src/app/portal/admin/nav.test.ts
git commit -m "feat(admin): typed route registry for nav/breadcrumb/guards"
```

---

### Task A2: `<Breadcrumb>` + `getPageHeading` rewrite

**Files:**
- Create: `src/components/portal/breadcrumb.tsx`
- Modify: `src/components/portal/portal-shell.tsx` (`getPageHeading`, add breadcrumb render)
- Test: `src/components/portal/portal-shell.test.ts` (unit-test `getPageHeading` only)

**Interfaces:**
- Consumes: `crumbFor` from Task A1.
- Produces: `<Breadcrumb items={{ label: string; href?: string }[]} />`. `getPageHeading` now delegates admin paths to `crumbFor` and returns `{ section, title }` from the last two crumbs.

- [ ] **Step 1: Write the failing test** — dynamic detail segment falls back to a generic label, deep admin path keeps the leaf.

```ts
// src/components/portal/portal-shell.test.ts
import { describe, it, expect } from "vitest";
import { getPageHeading } from "./portal-shell";

describe("getPageHeading (admin nested)", () => {
  it("nested admin page shows group + leaf", () => {
    expect(getPageHeading("/portal/admin/members/roles")).toEqual({ section: "Members & Access", title: "Roles & Access" });
  });
  it("dynamic detail segment uses the generic detail title, not the raw id", () => {
    expect(getPageHeading("/portal/admin/content/surveys/srv_123")).toEqual({ section: "Surveys", title: "Survey details" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `pnpm vitest run src/components/portal/portal-shell.test.ts` — Expected: FAIL (`getPageHeading` not exported / old one-level logic).

- [ ] **Step 3: Implement** — export `getPageHeading`; replace the `split("/")[3]` branch with a `crumbFor`-based one; keep the existing `detailTitles` map for dynamic segments.

```tsx
// src/components/portal/breadcrumb.tsx
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-1">
          {i > 0 ? <ChevronRight className="size-3.5 opacity-60" aria-hidden /> : null}
          {item.href ? (
            <Link href={item.href} className="hover:text-foreground">{item.label}</Link>
          ) : (
            <span className="text-foreground font-medium" aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
```

In `portal-shell.tsx`: `import { crumbFor } from "@/app/portal/admin/nav";` and rewrite the admin branch of `getPageHeading`:

```ts
// inside getPageHeading, replace the `cleanPath.startsWith("/portal/admin/")` block:
if (cleanPath.startsWith("/portal/admin")) {
  // dynamic detail pages: /portal/admin/<group>/<page>/<id...>
  for (const [prefix, title] of Object.entries(detailTitles)) {
    if (cleanPath.startsWith(`${prefix}/`)) {
      const crumb = crumbFor(prefix); // label of the parent page
      return { section: crumb.at(-1)?.label ?? "Admin", title };
    }
  }
  const trail = crumbFor(cleanPath);
  if (cleanPath === "/portal/admin") return { section: "Admin", title: "Console" };
  return { section: trail.at(-2)?.label ?? "Admin", title: trail.at(-1)?.label ?? "Console" };
}
```

Add `"/portal/admin/content/surveys": "Survey details"` to `detailTitles` (replacing the old `/portal/admin/surveys` key). Render `<Breadcrumb items={crumbFor(pathname)} />` in the shell header where `pageHeading` is shown, for admin paths only.

- [ ] **Step 4: Run test to verify it passes** — Run: `pnpm vitest run src/components/portal/portal-shell.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/portal/breadcrumb.tsx src/components/portal/portal-shell.tsx src/components/portal/portal-shell.test.ts
git commit -m "feat(admin): nested breadcrumb + multi-level getPageHeading"
```

---

### Task A3: `<AdminIntro>` component

**Files:**
- Create: `src/components/portal/admin-intro.tsx`

**Interfaces:**
- Produces: `<AdminIntro title={string} whoFor={string} effect={string} />` — compact (≤3 lines) help callout using the existing `Card` styling; no dismiss state required.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/portal/admin-intro.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminIntro } from "./admin-intro";

describe("AdminIntro", () => {
  it("renders title, who-for, and effect copy", () => {
    render(<AdminIntro title="Member List" whoFor="Officers onboarding members" effect="Adding an email lets that person sign in." />);
    expect(screen.getByText("Member List")).toBeInTheDocument();
    expect(screen.getByText(/lets that person sign in/)).toBeInTheDocument();
  });
});
```

(If the repo has no React test renderer configured, instead assert the component is a pure function returning the three strings — check `vitest.config` / existing `*.test.tsx`. Match the existing component-test pattern; if none exists, keep AdminIntro trivial and cover it via the e2e in Task E3 instead of a unit test.)

- [ ] **Step 2: Run** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// src/components/portal/admin-intro.tsx
import { Info } from "lucide-react";

export function AdminIntro({ title, whoFor, effect }: { title: string; whoFor: string; effect: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">{title}.</span> {whoFor}. {effect}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/portal/admin-intro.tsx src/components/portal/admin-intro.test.tsx
git commit -m "feat(admin): AdminIntro help callout"
```

---

## PHASE B — IA migration (do AFTER Shortlinks merges)

### Task B1: Move the 11 pages into group folders

**Files (git mv — preserve history):**

- [ ] **Step 1: Create group dirs and move pages**

```bash
cd "src/app/portal/admin"
git mv roster members-list-tmp 2>/dev/null || true   # placeholder guard; real moves below
# members
mkdir -p members/list members/roles
git mv roster/page.tsx members/list/page.tsx
git mv roster/actions.ts members/list/actions.ts
# content
mkdir -p content
git mv announcements content/announcements
git mv library content/library
git mv surveys content/surveys
git mv submissions content/submissions
git mv links content/links
# data
mkdir -p data
git mv retention data/retention
git mv reporting data/exports
# system
mkdir -p system
git mv nav-pins system/nav-pins
git mv quick-links system/quick-links
git mv audit system/audit
```

(Adjust: `roster` becomes `members/list`; `reporting` becomes `data/exports`. `retention`'s `member-checklist.tsx`/`retention-form.tsx` move with the folder.)

- [ ] **Step 2: Fix intra-page imports** — update any relative imports broken by the move (most use `@/` absolute paths, so few break). Run `pnpm tsc --noEmit` locally is NOT allowed against shared dev; instead grep for now-wrong relative imports: `rg "\.\./\.\./" src/app/portal/admin`.

- [ ] **Step 3: Commit the moves**

```bash
git add -A src/app/portal/admin
git commit -m "refactor(admin): move pages into members/content/data/system groups"
```

(No test here — this task is verified by B7's grep gate + build once the tree is buildable.)

---

### Task B2: Group layouts + `notFound()` index pages

**Files (create ×4 each):** `src/app/portal/admin/<group>/layout.tsx`, `src/app/portal/admin/<group>/page.tsx` for `members`, `content`, `data`, `system`.

**Interfaces:** Consumes `visibleGroups`, `adminGroups` from A1; `AdminIntro` from A3.

- [ ] **Step 1: Implement each group layout** (example for `members`; the other 3 are identical except the segment string):

```tsx
// src/app/portal/admin/members/layout.tsx
import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth/actor";
import { visibleGroups } from "../nav";

export const dynamic = "force-dynamic";

export default async function MembersGroupLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const group = visibleGroups(actor).find((g) => g.segment === "members");
  if (!group) notFound();
  return <div className="grid gap-6">{children}</div>;
}
```

- [ ] **Step 2: Implement each group index** (tiles for the group's visible pages):

```tsx
// src/app/portal/admin/members/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth/actor";
import { AdminIntro } from "@/components/portal/admin-intro";
import { visibleGroups } from "../nav";

export const dynamic = "force-dynamic";

export default async function MembersGroupIndex() {
  const actor = await requireActor();
  const group = visibleGroups(actor).find((g) => g.segment === "members");
  if (!group) notFound();
  return (
    <div className="grid gap-4">
      <AdminIntro title={group.label} whoFor="Manage who is in CODE and who has admin powers" effect="Pick a page below to continue." />
      <div className="grid gap-3 sm:grid-cols-2">
        {group.pages.map((p) => (
          <Link key={p.href} href={p.href} className="rounded-xl border border-border bg-card p-4 hover:border-accent">
            <span className="block font-medium">{p.label}</span>
            <span className="block text-sm text-muted-foreground">{p.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

Repeat for `content`, `data`, `system` (change segment + the `whoFor` line).

- [ ] **Step 3: Commit**

```bash
git add src/app/portal/admin/{members,content,data,system}/layout.tsx src/app/portal/admin/{members,content,data,system}/page.tsx
git commit -m "feat(admin): group layouts with notFound + group index tiles"
```

---

### Task B3: Grouped console nav + dashboard from the registry

**Files:**
- Modify: `src/app/portal/admin/layout.tsx` (replace flat `AdminTabs` list with grouped nav from `visibleGroups`)
- Modify: `src/app/portal/admin/page.tsx` (replace flat 8-card grid with grouped sections)
- Modify: `src/components/portal/admin-tabs.tsx` only if a grouped variant is needed (optional)

- [ ] **Step 1: Rewrite `admin/layout.tsx`** to build tabs/sections from `visibleGroups(actor)` instead of the hardcoded `tabs` array. Keep the `hasAnyAdminScope` redirect. Render the group headers + each group's pages.

- [ ] **Step 2: Rewrite `admin/page.tsx` (dashboard)** to render `visibleGroups(actor)` as 4 labeled sections of tiles (label + `p.description`), replacing the current `modules` array. Keep the Quick Links card (now "Dashboard Shortcuts") gated on `nav:configure`.

- [ ] **Step 3: Commit**

```bash
git add src/app/portal/admin/layout.tsx src/app/portal/admin/page.tsx
git commit -m "feat(admin): grouped console nav + dashboard from route registry"
```

---

### Task B4: Retarget every `revalidatePath` + internal link + label

**Files (modify):** every `src/app/portal/admin/*/actions.ts` that calls `revalidatePath("/portal/admin/<old>")`, plus any `<Link>`/`redirect()` to old paths, plus rename labels to the spec map.

- [ ] **Step 1: Find every reference**

Run: `rg -n "/portal/admin/(roster|reporting|retention|nav-pins|quick-links|links|surveys|announcements|library|submissions|audit)" src e2e`

- [ ] **Step 2: Retarget each** to the new path (e.g. `revalidatePath("/portal/admin/roster")` → `"/portal/admin/members/list"`; `reporting` → `data/exports`; `links` → `content/links`; etc.). Update visible labels touched by the pages to the rename map (Roster→Member List, Reporting→Data Exports, Retention→Log Retention, Submissions→Public Submissions, Nav pins→Pinned Nav Links, Quick links→Dashboard Shortcuts, Audit→Activity Log).

- [ ] **Step 3: Commit**

```bash
git add -A src/app/portal/admin
git commit -m "refactor(admin): retarget revalidatePath + links + rename labels"
```

---

### Task B7: Migration grep gate (acceptance test) + e2e update

**Files:**
- Modify: `e2e/retention-record.spec.ts` (old admin paths → new)
- Create: `e2e/admin-nav.spec.ts` (smoke: each group index reachable, breadcrumb renders)

- [ ] **Step 1: Write the grep gate** as a test that fails if any old path string remains.

```ts
// src/app/portal/admin/no-legacy-paths.test.ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("admin route migration", () => {
  it("no legacy /portal/admin/<old> path strings remain", () => {
    const oldSegments = ["roster", "reporting"]; // segments that were renamed away entirely
    const pattern = `/portal/admin/(${oldSegments.join("|")})`;
    // rg exits 1 when no matches → good. Any match → fail with the offending lines.
    let matches = "";
    try {
      matches = execSync(`rg -n "${pattern}" src e2e docs || true`, { encoding: "utf8" });
    } catch { matches = ""; }
    expect(matches.trim(), matches).toBe("");
  });
});
```

(Note: `roster`/`reporting` fully disappear; `retention`, `links`, `surveys`, etc. still exist as sub-paths under new groups, so only test the renamed-away segments to avoid false positives. Confirm the final segment list against Task B4's grep.)

- [ ] **Step 2: Run** — Expected initially FAIL listing any stragglers; fix them, then PASS.

- [ ] **Step 3: Update `e2e/retention-record.spec.ts`** paths to `/portal/admin/data/retention`.

- [ ] **Step 4: Commit**

```bash
git add src/app/portal/admin/no-legacy-paths.test.ts e2e/retention-record.spec.ts e2e/admin-nav.spec.ts
git commit -m "test(admin): migration grep gate + nav e2e"
```

---

## PHASE C — Roles & Access

### Task C1: `members.search`

**Files:**
- Modify: `src/db/repositories/members.ts` (add `search` to interface + impl)
- Test: `src/db/repositories/members.search.test.ts`

**Interfaces:**
- Produces: `search(actor: Actor, query: string): Promise<Member[]>` on `MembersRepository`. Authorizes on `role:assign` OR `member:manage`; min length 2; active members only; case-insensitive `LIKE` over name/full_name/nickname/email; cap 20.

- [ ] **Step 1: Failing test** (mirror the existing `roster.integration.test.ts` harness for a real D1/local-sqlite db).

```ts
// src/db/repositories/members.search.test.ts
import { describe, it, expect, beforeEach } from "vitest";
// ...set up test db + repositories like roster.integration.test.ts...
describe("members.search", () => {
  it("matches name or email, case-insensitive, active only, capped", async () => {
    // seed: active "Juan Dela Cruz" juan@code.org, inactive "Old Member" old@code.org
    const admin = { memberId: "a", roles: ["member_admin"] as const };
    const byName = await repositories.members.search(admin, "dela");
    expect(byName.map((m) => m.email)).toContain("juan@code.org");
    const byEmail = await repositories.members.search(admin, "JUAN@");
    expect(byEmail.length).toBe(1);
    const inactive = await repositories.members.search(admin, "old");
    expect(inactive).toEqual([]);
  });
  it("rejects a non-authorized actor and short queries", async () => {
    await expect(repositories.members.search({ memberId: "x", roles: ["member"] }, "de")).rejects.toThrow();
    expect(await repositories.members.search({ memberId: "a", roles: ["member_admin"] }, "d")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** — Expected FAIL (`search` not a function).

- [ ] **Step 3: Implement** — add to `MembersRepository` and `createMembersRepository`. The narrow `MemberDb` structural type won't express `or`/`like`; widen the impl to use the real drizzle builder (the concrete `db` is `DrizzleD1Database`). Use:

```ts
import { and, eq, or, like, sql } from "drizzle-orm";
// interface:
search(actor: Actor, query: string): Promise<Member[]>;
// impl:
async search(actor, query) {
  if (!can(actor, "role:assign") && !can(actor, "member:manage")) {
    throw new Error("Not authorized to search members.");
  }
  const q = query.trim();
  if (q.length < 2) return [];
  const like$ = `%${q.toLowerCase()}%`;
  return db
    .select()
    .from(members)
    .where(
      and(
        eq(members.status, "active"),
        or(
          like(sql`lower(${members.name})`, like$),
          like(sql`lower(${members.fullName})`, like$),
          like(sql`lower(${members.nickname})`, like$),
          like(sql`lower(${members.email})`, like$),
        ),
      ),
    )
    .limit(20) as Promise<Member[]>;
}
```

(Widen `MemberDb` or annotate the impl `db` as `DrizzleD1Database<typeof schema>`; follow whatever the retention/links repos do for multi-column queries.)

- [ ] **Step 4: Run** — Expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/members.ts src/db/repositories/members.search.test.ts
git commit -m "feat(members): active-only name/email search for role assignment"
```

---

### Task C2: Roles repository — read side

**Files:**
- Create: `src/db/repositories/roles.ts`
- Test: `src/db/repositories/roles.test.ts`

**Interfaces:**
- Produces: `type AssignableRole = { key: RoleKey; label: string; description: string; assignable: boolean };` `listAssignableRoles(actor): Promise<AssignableRole[]>` (all seeded roles except `member`; `events`/`calendar` marked `assignable:false`). `getMemberRoleKeys(actor, memberId): Promise<RoleKey[]>` (sorted). `baseVersionOf(keys: RoleKey[]): string` (stable join of sorted keys — the optimistic-concurrency token).

- [ ] **Step 1: Failing test**

```ts
// src/db/repositories/roles.test.ts (read side)
it("lists assignable roles excluding member, marks events inactive", async () => {
  const roles = await repositories.roles.listAssignableRoles(superActor);
  expect(roles.find((r) => r.key === "member")).toBeUndefined();
  expect(roles.find((r) => r.key === "calendar" /* shown as Events */)?.assignable).toBe(false);
});
it("returns a member's current role keys sorted, and a stable baseVersion", async () => {
  // seed member with [publishing, super]
  const keys = await repositories.roles.getMemberRoleKeys(superActor, "m1");
  expect(keys).toEqual(["publishing", "super"]);
  expect(repositories.roles.baseVersionOf(keys)).toBe("publishing|super");
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** the read methods (`db.select` join `member_roles`→`roles`; `role:assign` gate). `baseVersionOf = (keys) => [...keys].sort().join("|")`. Mark `assignable:false` for keys with an empty permission set today (`calendar`) — the UI renders them disabled "coming soon".

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** `feat(roles): read assignable roles + member role keys`

---

### Task C3: Roles repository — atomic save with guardrails

**Files:**
- Modify: `src/db/repositories/roles.ts` (add `saveMemberRoles`)
- Test: `src/db/repositories/roles.test.ts` (guardrail + concurrency + rollback cases)

**Interfaces:**
- Produces: `saveMemberRoles(actor, input: { memberId: string; desiredRoleKeys: RoleKey[]; baseVersion: string }): Promise<{ roleKeys: RoleKey[] }>`.

- [ ] **Step 1: Failing tests** (the important ones):

```ts
it("computes diff server-side and writes member_roles + audit atomically", async () => {
  const base = repositories.roles.baseVersionOf(await repositories.roles.getMemberRoleKeys(superActor, "m1"));
  await repositories.roles.saveMemberRoles(superActor, { memberId: "m1", desiredRoleKeys: ["publishing"], baseVersion: base });
  expect(await repositories.roles.getMemberRoleKeys(superActor, "m1")).toEqual(["publishing"]);
  // audit rows exist for the change
});
it("rejects a stale baseVersion (optimistic concurrency)", async () => {
  await expect(repositories.roles.saveMemberRoles(superActor, { memberId: "m1", desiredRoleKeys: [], baseVersion: "stale" }))
    .rejects.toThrow(/reload/i);
});
it("non-super cannot add or remove super via a desired set", async () => {
  const memberAdmin = { memberId: "b", roles: ["member_admin"] as const };
  const base = repositories.roles.baseVersionOf(await repositories.roles.getMemberRoleKeys(memberAdmin, "m2"));
  await expect(repositories.roles.saveMemberRoles(memberAdmin, { memberId: "m2", desiredRoleKeys: ["super"], baseVersion: base }))
    .rejects.toThrow(/overall admin/i);
});
it("blocks removing the last super", async () => {
  // m1 is the only super
  const base = repositories.roles.baseVersionOf(["super"]);
  await expect(repositories.roles.saveMemberRoles(superActor, { memberId: "m1", desiredRoleKeys: [], baseVersion: base }))
    .rejects.toThrow(/at least one Overall Admin/i);
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** `saveMemberRoles`:
  1. `if (!actor.memberId) throw` (fail closed); `if (!can(actor, "role:assign")) throw`.
  2. Load current keys fresh; `if (baseVersionOf(current) !== input.baseVersion) throw new Error("Roles changed — reload and try again.")`.
  3. Reject non-assignable keys in `desiredRoleKeys` (`calendar`/events, `member`).
  4. `toAdd = desired − current`, `toRemove = current − desired`.
  5. `if ((toAdd.includes("super") || toRemove.includes("super")) && !actor.roles.includes("super")) throw new Error("Only Overall Admins can grant or remove Overall Admin.")`.
  6. Map keys → role ids via the `roles` table.
  7. Build statements: for each add, `insert(memberRoles)`; for each remove, a `delete`; **for a `super` removal use the guarded conditional delete** (`sql` with the `(SELECT count(*) …) > 1` guard); one `audit.record`-equivalent insert per change (category `"role"`, action `role:assign`/`role:revoke`, `assigned_by = actor.memberId`). Run all in one `db.batch([...])`.
  8. After the batch, re-read super count; if a `super` removal left 0 (guard row-count 0), throw "at least one Overall Admin required" (the guarded delete simply won't have removed it — detect and error).
  Return the new key set.

- [ ] **Step 4: Run** — PASS (incl. a rollback test: force the audit insert to fail and assert the role change did not persist).

- [ ] **Step 5: Commit** `feat(roles): atomic saveMemberRoles with concurrency + super guardrails`

---

### Task C4: Wire `roles` repo + `members.search` into repositories

**Files:**
- Modify: `src/db/repositories/index.ts` (`createDrizzleRepositories` adds `roles`; shared adapter parity in `createSharedRepositories`)
- Test: extend `src/db/shared-parity.integration.test.ts` if it enumerates repos

- [ ] **Step 1** Failing parity test (if applicable) referencing `repositories.roles`.
- [ ] **Step 2** Run — FAIL.
- [ ] **Step 3** Add `roles: createRolesRepository(db, audit)` to the drizzle factory; for shared-dev, either add internal-contract ops or make roles read return an explicit "unavailable" and writes throw (spec §5 — reads must not fake `[]`, writes fail loud). Do NOT silently `.catch(() => [])` for roles.
- [ ] **Step 4** Run — PASS.
- [ ] **Step 5** Commit `feat(db): register roles repository (+ shared-dev fail-loud)`

---

### Task C5: Roles & Access page + server action

**Files:**
- Create: `src/app/portal/admin/members/roles/page.tsx`, `.../roles/actions.ts`
- (Client component for search + toggles + confirm dialog, e.g. `.../roles/roles-editor.tsx`)

**Interfaces:**
- `saveMemberRolesAction(formData)` — `role:assign`-gated server action, calls `assertSameOrigin`, parses `memberId`, `desiredRoleKeys` (repeated field), `baseVersion` with Zod, calls `repositories.roles.saveMemberRoles`, `revalidatePath("/portal/admin/members/roles")`.

- [ ] **Step 1** Failing test for the action's auth + origin (mirror an existing `actions` test if present, else cover via the repo tests in C3 and an e2e in E3).
- [ ] **Step 2** Run — FAIL / N/A.
- [ ] **Step 3** Implement the page (server component: `requireActor`, `can(actor,"role:assign")` else `redirect`; `AdminIntro`; render the client editor with `listAssignableRoles` + a search box that calls a `searchMembersAction`). Client editor: search → pick member → load their keys + baseVersion → checkboxes (super disabled for non-super; Events disabled) → confirm dialog when removing own roles → submit desired set + baseVersion. On a stale-version error, prompt reload.
- [ ] **Step 4** Run relevant tests — PASS.
- [ ] **Step 5** Commit `feat(admin): Roles & Access page (member-first, guardrailed)`

---

## PHASE D — Bulk add

### Task D1: Shared email parser

**Files:**
- Create: `src/lib/roster-emails.ts`
- Test: `src/lib/roster-emails.test.ts`

**Interfaces:**
- Produces: `parseEmailColumn(raw: string): { valid: string[]; invalid: string[]; dedupedInput: number }` — split on `\n , ; \s`, `trim().toLowerCase()`, validate with the same rule as roster `addSchema` (`z.string().email()`), dedupe (count collapses in `dedupedInput`), reject display-name/quoted forms.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseEmailColumn } from "./roster-emails";
describe("parseEmailColumn", () => {
  it("splits, lowercases, dedupes, and separates invalid", () => {
    const r = parseEmailColumn("A@x.com\nA@X.com, b@y.com; not-an-email\n\"Jane\" <j@z.com>");
    expect(r.valid.sort()).toEqual(["a@x.com", "b@y.com"]);
    expect(r.invalid).toEqual(["not-an-email", '"jane" <j@z.com>']);
    expect(r.dedupedInput).toBe(1); // one A@x.com collapsed
  });
});
```

- [ ] **Step 2** Run — FAIL.
- [ ] **Step 3** Implement with `z.string().email()`; reject tokens containing spaces/`<`/`>`/`"`. Refactor the existing roster `addSchema` to reuse this (single source).
- [ ] **Step 4** Run — PASS.
- [ ] **Step 5** Commit `feat(roster): shared email column parser`

---

### Task D2: `bulkAddRoster` repo method + action

**Files:**
- Modify: `src/db/repositories/roster.ts` (add `bulkAdd`) + `src/app/portal/admin/members/list/actions.ts` (add `bulkAddRosterAction`)
- Test: `src/db/repositories/roster.bulk.test.ts`

**Interfaces:**
- Produces: `roster.bulkAdd(actor, { termId, emails: string[] }): Promise<{ added: number; alreadyMembers: number }>` — `roster:manage`-gated; chunked `db.batch` inserts with `onConflictDoNothing` on `(termId, email)`; `alreadyMembers` = requested − added. `bulkAddRosterAction(formData)` — `assertSameOrigin`, parse `termId` + raw text (≤64 KB, ≤500 parsed valid), call `parseEmailColumn` then `bulkAdd`, return `{ added, alreadyMembers, dedupedInput, invalid }`.

- [ ] **Step 1: Failing test** — idempotency + counts.

```ts
it("inserts new, skips existing, reports counts", async () => {
  await repositories.roster.add(admin, { termId: "t1", email: "a@x.com" });
  const r = await repositories.roster.bulkAdd(admin, { termId: "t1", emails: ["a@x.com", "b@y.com", "c@z.com"] });
  expect(r).toEqual({ added: 2, alreadyMembers: 1 });
});
it("rejects over the 500 cap", async () => {
  const many = Array.from({ length: 501 }, (_, i) => `u${i}@x.com`);
  await expect(repositories.roster.bulkAdd(admin, { termId: "t1", emails: many })).rejects.toThrow(/500/);
});
```

- [ ] **Step 2** Run — FAIL.
- [ ] **Step 3** Implement `bulkAdd`: guard `roster:manage`; cap 500; chunk into batches (≤~90 rows/statement); `insert(termMemberRoster).values(rows).onConflictDoNothing()`; compute `added` from affected counts (or by pre-counting existing). Audit one summary row.
- [ ] **Step 4** Run — PASS.
- [ ] **Step 5** Commit `feat(roster): bulk add with chunked batch + idempotency`

---

### Task D3: Member List bulk-add UI

**Files:**
- Modify: `src/app/portal/admin/members/list/page.tsx` (add `AdminIntro`, bulk textarea + live counts + result)

- [ ] **Step 1** Implement the textarea + a client preview using `parseEmailColumn` showing "N valid · M dedup · K invalid", submit to `bulkAddRosterAction`, render `{ added, alreadyMembers, dedupedInput, invalid }` with a copyable invalid list. Keep the single-add form.
- [ ] **Step 2** Manual/e2e check (covered in E3).
- [ ] **Step 3** Commit `feat(admin): bulk email add on Member List`

---

## PHASE E — Onboarding polish

### Task E1: Intro cards on every admin page

**Files (modify each page):** add `<AdminIntro>` at the top of every admin page using the `description` from `nav.ts` for the title/effect. Enumerate: `members/list`, `members/roles`, `content/{announcements,library,surveys,submissions,links}`, `data/{retention,exports}`, `system/{nav-pins,quick-links,audit}`.

- [ ] **Step 1** Add the callout to each (copy per spec: what it is · who for · what happens on action).
- [ ] **Step 2** Commit `feat(admin): in-context intro cards on every page`

### Task E2: Inline hints + empty states

- [ ] **Step 1** Add helper text under key inputs (email field, bulk textarea, role search) and standardize empty states.
- [ ] **Step 2** Commit `feat(admin): inline hints + empty states`

### Task E3: Final gate + full test run

- [ ] **Step 1** Run the migration grep gate + full unit/integration suite: `pnpm vitest run` (do NOT deploy). Expected: all green.
- [ ] **Step 2** Run the admin e2e: `pnpm exec playwright test e2e/admin-nav.spec.ts e2e/retention-record.spec.ts`. Expected: green (or note environment limits).
- [ ] **Step 3** Final commit / open PR.

---

## Self-Review (author checklist — done)

- **Spec coverage:** IA/groups/rename → A1,B1-B4; breadcrumb → A2; Roles page + guardrails + concurrency → C1-C5; bulk add → D1-D3; onboarding → A3,E1-E2; shared-dev fail-loud → C4; migration grep gate → B7,E3. ✔
- **Placeholders:** none — novel logic has real code; mechanical moves have exact commands. Page-move relative-import fixes are grep-guided (can't enumerate blind).
- **Type consistency:** `baseVersionOf`/`saveMemberRoles`/`getMemberRoleKeys`/`search`/`parseEmailColumn`/`bulkAdd` signatures match across tasks. `AdminPage`/`AdminGroup` used consistently.
- **Open verification for the executor:** widen `MemberDb` vs use concrete `DrizzleD1Database` for `search`; confirm React component test harness exists (else cover AdminIntro via e2e); confirm `roles` table seeded in shared dev before wiring C4.
