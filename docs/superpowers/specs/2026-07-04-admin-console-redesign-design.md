# Admin Console Redesign — Design Spec

**Date:** 2026-07-04
**Status:** Ready for planning — revised through two adversarial passes (see review log)
**Branch:** beta

## Problem

The `/portal/admin` console is one flat 12-tab bar plus an 8-card grid. Everything sits at the
same level, several pages use internal jargon ("Roster", "Reporting" vs "Retention"), and there
is no in-page explanation, so a first-time admin cannot tell what a page does or who it is for.
Two gaps compound the confusion:

1. **No bulk member add.** The Member List (roster) accepts one email at a time; officers onboard
   a whole batch from a Google Sheet column.
2. **No role-assignment UI at all.** The permission model (`role:assign`, the `roles` and
   `member_roles` tables, roles `super` / `member_admin` / `publishing` / `retention` / `link` /
   `calendar` / `member`) is fully built in the data layer but **nothing in the app assigns roles**.
   There is no page to make someone an admin.

## Goals

- Group admin pages into 4 nested sections with a real breadcrumb, so the console is navigable.
- Rename internal jargon to plain language.
- Add a **Roles & Access** page (member-first) to grant/revoke admin roles safely.
- Add **bulk add** (paste a column of emails) to the Member List.
- Add consistent in-context explanation (intro card + inline hints + empty states) to every page.

## Non-goals

- No new roles or changes to the permission model — only surfacing roles that already exist.
- No coach-mark tour and no separate guide page (intro cards were chosen instead).
- Old→new URL redirects are optional, not required (internal auth-gated routes; see §1).
- No change to how roles reach `actor.roles`: the Auth.js **database-session** `session()` callback
  already re-queries `member_roles` from D1 on every request (`src/auth.ts`), so role changes take
  effect immediately — no JWT staleness, no forced re-login.

## 1. Information architecture

### Groups, routes, and rename map

Pages move to `/portal/admin/<group>/<page>`. Each group folder owns a `layout.tsx` that renders
the group's sub-nav; the console root renders the grouped dashboard.

| Group (route seg) | New page name | Route | Old name / route | What it does |
|---|---|---|---|---|
| **Members & Access** (`members`) | Member List | `/portal/admin/members/list` | Roster · `/roster` | Official CODE members for a term; an email lets that person sign in |
| | Roles & Access ✨NEW | `/portal/admin/members/roles` | — | Grant admin roles to members |
| **Content** (`content`) | Announcements | `/portal/admin/content/announcements` | `/announcements` | Org posts |
| | Library | `/portal/admin/content/library` | `/library` | Articles & case studies |
| | Surveys | `/portal/admin/content/surveys` | `/surveys` | Sampling & questions |
| | Public Submissions | `/portal/admin/content/submissions` | Submissions · `/submissions` | Contact inquiries + article feedback from the public site |
| | Short Links | `/portal/admin/content/links` | Links · `/links` | Moderate member short links (member-generated content) |
| **Data** (`data`) | Log Retention | `/portal/admin/data/retention` | Retention · `/retention` | Record retention/attendance records |
| | Data Exports | `/portal/admin/data/exports` | Reporting · `/reporting` | CSV exports of retention data |
| **System** (`system`) | Pinned Nav Links | `/portal/admin/system/nav-pins` | Nav pins · `/nav-pins` | Links shown in every member's top nav |
| | Dashboard Shortcuts | `/portal/admin/system/quick-links` | Quick links · `/quick-links` | Resources in the dashboard Quick Links widget |
| | Activity Log | `/portal/admin/system/audit` | Audit log · `/audit` | Recorded admin actions |

Detail routes move with their parent (e.g. `surveys/[id]` → `content/surveys/[id]`).

### Route migration inventory (every mover + every reference)

Moving the routes is not just renaming folders — several files hardcode the old paths and MUST be
updated in the same change, or links/revalidation silently break:

- **Pages/layouts to move:** `roster`, `surveys` (+ `surveys/[id]`), `announcements`, `library`,
  `submissions`, `links`, `retention` (+ its `member-checklist`/`retention-form` components),
  `reporting`, `nav-pins`, `quick-links`, `audit`, plus the dashboard `page.tsx` and `layout.tsx`.
- **`revalidatePath("/portal/admin/<old>")` calls** in every action file: `roster/actions.ts`,
  `announcements/actions.ts`, `surveys/actions.ts`, `retention/actions.ts`, `quick-links/actions.ts`,
  `nav-pins/actions.ts`, `library/actions.ts` — retarget to the new nested paths.
- **Nav/hrefs/redirects:** `admin/layout.tsx` (tab list), `admin/page.tsx` (module tiles),
  `portal-shell.tsx`, and any `<Link>`/`redirect()` to old admin paths.
- **Tests:** `e2e/retention-record.spec.ts` and any spec asserting old paths/labels.

Acceptance criterion: after the move, a repo-wide grep for the old `/portal/admin/<old-page>` strings
(across `src/`, `e2e/`, `docs/`, seed data, and config) returns nothing. Planning starts from that
grep; the list above is a floor, not a ceiling.

**Authorization stays on the pages, not just the nav.** Each moved page keeps its own
`can(actor, ...)` guard (direct-URL access must fail without it); nav/tile filtering is cosmetic and
reads the SAME per-route permission from `nav.ts` (below) so the two can't drift. A group index with
no visible children returns not-found/redirect rather than an empty shell.

**Old→new redirects (optional).** Internal, auth-gated routes with no known external bookmarks. If
cheap, add a small old→new redirect map (Next `redirects()` or a catch route) as a safety net;
otherwise omit.

### Breadcrumb mechanics

`getPageHeading` in `src/components/portal/portal-shell.tsx` currently hardcodes
`split("/")[3]` — one level deep. Replace it with a segment walker that maps
`/portal/admin/<group>/<page>` to a breadcrumb trail using a single source-of-truth map of
`{ segment, label, href }`. The trail renders `Admin › <Group> › <Page>` with each ancestor
clickable. The map lives in `src/app/portal/admin/nav.ts` (new) so the layout, group layouts,
dashboard, and breadcrumb all read the same structure.

- `Admin` → `/portal/admin`
- `<Group>` → `/portal/admin/<group>` (group index; see below)
- `<Page>` → current page (not a link)

`nav.ts` is a **minimal typed route registry** — `{ segment, label, href, permission }` per route,
nothing else. Page intro **copy** stays local to each page (see §4), so the registry doesn't become a
god object.

**Dynamic detail segments** (e.g. `content/surveys/[id]`) resolve their crumb label from the existing
`detailTitles` map in `portal-shell.tsx` (a static generic label like "Survey details") — the shell
does **no** entity fetch for the crumb. A page that already has the entity title loaded may pass a
label override; an unknown id falls back to the generic label, never the raw id.

A `<Breadcrumb>` presentational component (new, in `src/components/portal/`) renders the trail;
it is generic (takes an array of `{ label, href? }`).

### Group index pages

Each `/portal/admin/<group>` renders a small landing: the group's intro card + the group's page
tiles, filtered to the pages the actor may see. If the actor has **no** visible page in that group,
the group index returns **`notFound()`** (not an empty shell, not a redirect). The console root
`/portal/admin` renders all 4 groups as labeled sections of tiles (replacing the current flat 8-card
grid), each tile showing name + one-line description; groups with no visible pages don't render.

## 2. Roles & Access page (`members/roles`)

Member-first flow, gated by `can(actor, "role:assign")`.

### Data

- **Read available roles** from the `roles` table (already seeded with `key`/`label`/`description`).
  Display only assignable roles (exclude `member`, which is the implicit baseline). Each role's
  plain description comes from the `roles.description` column; if a friendlier copy is wanted it is
  edited in the seed, not hardcoded in the page.
- **Member search:** new `members.search(actor, query)` repository method — case-insensitive `LIKE`
  over `name`, `full_name`, `nickname`, `email`, restricted to **active members** (`status='active'`),
  **min query length 2**, **capped at 20 rows**. At org scale (hundreds–low thousands) a capped
  `LIKE` scan is fine; add a normalized search index only if measured slow.
- **Permission (exact):** the page is gated on `role:assign`, and the member search used by this page
  authorizes on the **same `role:assign`** (not `member:manage`), so the flow needs exactly one
  permission and can't half-work. `members.search` accepts `role:assign` OR `member:manage`.
- **Read a member's roles:** join `member_roles` → `roles.key`; gated the same as the page.
- **Assignable targets (eligibility):** only existing **active** `members` rows. A roster email with
  no `members` row has no id and simply can't be targeted — you assign roles to people who have signed
  in. Roles are org-wide, not term-scoped. Inactive/departed members are excluded from search and
  rejected server-side.
- **One save path.** A single `saveMemberRolesAction(memberId, desiredRoleKeys, baseVersion)` handles
  the whole "Save changes" submit (no separate per-role actions that could drift from the guardrails).
  It:
  1. **fails closed** if `actor.memberId` is missing (defensive, even though the type guarantees it);
  2. calls the shared **`assertSameOrigin`** guard like every other mutation action;
  3. loads the member's **current roles fresh from D1**; `baseVersion` is a hash of that current
     role-key set taken when the client loaded — if it no longer matches, reject with "roles changed,
     reload" (**optimistic concurrency**, closes the concurrent lost-update race);
  4. computes the add/remove **diff server-side** (ignores any client notion of "current");
  5. applies the guardrails below to the **whole diff**;
  6. writes every `member_roles` insert/delete **and** one audit row per change
     (`role:assign` / `role:revoke`, `assigned_by = actor.memberId`) in a single **`db.batch([...])`**
     — D1 has no interactive transactions and rolls a batch back on any failed statement (master plan
     §3.4), verified by a rollback test.

### UI

```
Roles & Access
[intro card: who should use this, what a role unlocks, changes take effect immediately (next request)]

Search member:  [ jdela________ ]
  → Juan Dela Cruz   juan@code.org
  → Juana Dela Rosa  juana@code.org

Roles for Juan Dela Cruz
  [✓] Overall Admin   — full access to everything (only Overall Admins can grant this)
  [ ] Member Admin    — manage members, roles, nav pins, dashboard shortcuts
  [✓] Publishing      — announcements, library, article moderation
  [ ] Retention       — record retention, approve events, assign points
  [ ] Links           — moderate short links
  [·] Events          — coming soon (disabled, not assignable until the events system ships)
                  [ Save changes ]  ← submits desired set + baseVersion; stale save ⇒ "reload"
```

### Guardrails (enforced inside `saveMemberRolesAction`, on the whole diff)

1. **Only Overall Admins grant Overall Admin.** Any `super` delta in the computed diff (add OR
   remove) is rejected unless `actor.roles.includes("super")`. Checked on the **diff**, not the UI
   toggle, and **independent of `role:assign`** — holding the generic permission never implies the
   right to touch `super`. The UI also disables the `super` toggle for non-supers (sugar only).
2. **Block removing the last Overall Admin — race-safe.** Every `super` removal (including one that
   falls out of a desired-set save) goes through a **guarded conditional delete** — delete only if
   more than one `super` assignment exists: `DELETE FROM member_roles WHERE member_id=? AND
   role_id=:super AND (SELECT count(*) FROM member_roles WHERE role_id=:super) > 1` — then check
   affected-rows; 0 ⇒ reject "at least one Overall Admin required." One statement, no read-then-write
   TOCTOU; covered by a concurrency test.
3. **Confirm self-changes.** If the target is the current actor and the diff removes any of the
   actor's own roles, the UI shows a confirmation ("This removes your own access — continue?") before
   submitting. Revocation is immediate (see Non-goals), so self-demotion takes effect next request.

Server-side checks in the single save path are authoritative; client-side disabling is UX sugar.

## 3. Member List + bulk add (`members/list`)

Keep the term picker and table; rename, add intro card, add bulk add.

- **Intro card:** what the list is (official members this term), that adding an email lets that
  person sign in, and that members link automatically on first login.
- **Shared parser.** Single-add and bulk-add use ONE canonical normalizer/validator (the existing
  roster `addSchema`: `trim().toLowerCase().email()`), so both paths behave identically. The client
  parse (split on newlines/commas/semicolons/whitespace, dedupe) is **preview only**; the server
  action re-parses and re-validates the raw text so a hand-edited request can't inject bad rows.
- **Bulk add UI:** a textarea labeled "Paste a column of emails (e.g. from Google Sheets)". Live
  summary **"N valid · M already members · K invalid"**, invalid entries listed for fixing. The
  single-add form stays for one-offs.
- **Limits (D1 budget + abuse).** Cap at **≤ 500 emails** and **≤ 64 KB** of pasted text per
  submission; return at most **50** invalid entries (with a "+N more" count). Over any cap ⇒ reject
  with guidance to split. Insert in **chunked `db.batch([...])`** within D1's ~100-bound-param /
  100 KB-per-statement budget (mirrors the manual-retention batch pattern; exact chunk size confirmed
  in planning).
- **Canonical email rule.** Accept only plain RFC-ish addresses (the existing `addSchema`:
  `trim().toLowerCase().email()`); reject display-name/quoted forms (`Jane <j@x.com>`). Lowercasing is
  for dedupe/storage only — no provider-specific equivalence (no gmail dot/plus folding).
- **Idempotent, partial success.** Insert with `onConflictDoNothing` against the `term_member_roster`
  PK `(termId, email)` (confirmed `schema.ts:296`), so members already on the roster are skipped, not
  errored. `bulkAddRosterAction(termId, rawText)` returns **separate** counts
  `{ added, alreadyMembers, dedupedInput, invalid: string[] }` so the admin sees exactly what
  happened. Valid rows commit even when some are invalid; the UI states partial success explicitly and
  offers the invalid list as copyable text for a fixed resubmit.
- **Write safety in shared-dev:** see §5 — bulk add fails loudly if the write path is unavailable,
  never silently reports success.

## 4. Onboarding pattern

- New `<AdminIntro title, whoFor, effect>` component (in `src/components/portal/`) rendered at the
  top of every admin page and each group index: a short "What this is · Who should use it · What
  happens when you act" callout. Keep it **compact** (2–3 lines) so it never pushes primary controls
  below the fold on dense pages; a collapse toggle is optional. Per-route identity/label/short
  description come from the single `nav.ts` map (§1) so tiles, breadcrumb, and nav can't drift; only
  the longer intro **body** copy is a local prop.
- Inline helper text under inputs (e.g. the email field, the bulk textarea).
- Meaningful empty states where lists can be empty (already partially present; standardize).
- Console dashboard tiles show a one-line description each (data already exists in the module list).

## 5. Shared-dev / internal-proxy consideration (build-time)

Repositories route through an internal proxy in the shared-dev Worker. `roster.listForTerm` and
`quickLinks.list` already `.catch(() => [])` because "no shared-dev internal proxy yet." The new
`members.search` and role read/write must either (a) work directly against D1 in the normal path,
or (b) add internal-contract operations. **Admin-critical reads and all writes must not silently
lie:**
- **Reads** (member search, a member's roles): on an unavailable path, return an explicit
  **"unavailable"** state, not `[]` — an empty array reads as "no members found" and makes role
  assignment undebuggable.
- **Writes** (save roles, bulk add): throw a **typed error** the action surfaces as clear UI copy
  ("This action isn't available in the shared-dev environment"); never no-op or fake success.
Per project rules, **any internal-contract/permissions/dev-seed change requires updating the dev
Worker path** (`pnpm db:migrate:dev` then `pnpm deploy:dev`) — shown as an explicit command and
run only with approval. No schema migration is expected (roles/member_roles already exist); confirm
during planning whether the roles table is seeded in shared dev.

## Testing strategy

- **Unit:** shared email parser/normalizer (valid/invalid/dup/whitespace/comma/CRLF, display-name
  reject, over-cap); server-side role-diff (recomputed from DB, ignores client "current"); breadcrumb
  segment walker incl. dynamic `content/surveys/[id]` (generic label, unknown-id fallback).
- **Permission/guardrail:** non-super cannot add or remove `super` in a whole-set save (independent
  of `role:assign`); `role:assign` gates page + search + save; direct-URL access to a moved page
  fails without its `can()` guard; role assignment to an inactive member is rejected — mirror
  `permissions.test.ts`.
- **Concurrency:** two simultaneous last-super removals ⇒ exactly one succeeds, one `super` remains
  (guarded-delete race); a stale `baseVersion` save is rejected (optimistic concurrency).
- **Atomicity:** a forced failure of the audit statement rolls back the `member_roles` change in the
  same `db.batch` (rollback test).
- **Integration:** `members.search` matches name/full_name/nickname/email case-insensitively, active-
  only, min-length + capped; save writes `member_roles` + audit atomically; bulk add is idempotent
  and returns `{ added, alreadyMembers, dedupedInput, invalid }`.
- **Migration:** repo-wide check that no old `/portal/admin/<old>` string remains in `src/`, `e2e/`,
  `docs/`, seed, or config.

## Open questions

- Confirm during planning: roles table seeded in shared dev; exact chunk size for bulk `db.batch`
  under the D1 param budget.
- The `calendar` role shows as **Events (inactive)** — grants nothing today, so assigning it is
  harmless. Renaming `calendar` → `events` and giving it real powers is the events-system spec's job;
  until then it stays labeled inactive to avoid a "granted a role that silently gains power" footgun.

## Review history

Two adversarial passes (round 1 folded after repo verification; round 2 "fix-first" resolved — the
substantive item was the unified concurrency-safe save path in §2). The full finding-by-finding
disposition, including what was rejected and why, lives in the non-normative companion
`2026-07-04-admin-console-redesign-review-log.md`. This spec is the single normative source.
