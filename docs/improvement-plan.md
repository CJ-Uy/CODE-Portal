# CODE Portal — Improvement Audit & Plan (2026-07-03, rev 2)

Baseline: branch `beta` @ `d0f24dc`. Typecheck clean, lint clean, 209/209 vitest passing, 4 e2e specs.
Verified clean during audit (no action needed): e2e auth bypass route is env-gated (`APP_ENV=local` + `E2E_AUTH_BYPASS=1`), contact API is rate-limited + zod-capped.

## A. Functionality gaps (bugs / dead features)

| # | Finding | Where | Fix |
|---|---------|-------|-----|
| A1 | **Nav pins + quick links are the same concept built twice, and neither reaches members.** `nav_pins` and `quick_links` tables are identical except `icon`; both have admin CRUD, repos, seed data — and zero member-facing render. Layout hardcodes `navPins = []` (stale `TODO(phase-8)`), `navPins.list()` is admin-gated so members couldn't read pins anyway, and the shared-dev adapter stubs both repos. | `src/app/portal/layout.tsx:48`, `src/db/repositories/navPins.ts:41`, `src/db/repositories/index.ts:110`, `src/db/schema.ts:443,460` | **Merge:** keep `nav_pins` (has `icon`), migrate `quick_links` rows in, delete the quick-links module/repo/page. Then: ungated `listVisible()` (pins render in every member's nav by design), shared-dev proxy route, wire layout with narrow catch. One feature shipped instead of two half-built. |
| A2 | Hardcoded `currentTermId = "term_2026_1"` feeds the scan panel; silently wrong at term rollover. | `src/app/portal/page.tsx:49` | Derive from `retention.listTerms()` current term; hide scan panel if no current term. |
| A3 | No member surveys index: only `/portal/surveys/[id]` exists. Overview "Surveys pending" metric is not clickable — members can't discover pending surveys. | `src/app/portal/surveys/`, `src/app/portal/page.tsx:65` | Add `/portal/surveys` list (pending first, answered greyed); make the metric card link to it. |
| A4 | Admin dashboard omits three existing modules — retention recording, quick links, submissions are orphan URLs reachable only by typing the path. | `src/app/portal/admin/page.tsx:30-39` | Add retention + submissions cards with `can()` gates. Quick links card dies with the A1 merge. |
| A5 | `/portal/events` renders the Retention page (comment in `nav-items.ts` admits it). Deep links, analytics, and code all say "events" for retention. | `src/app/portal/events/page.tsx`, `src/components/portal/nav-items.ts` | Rename route to `/portal/retention`; keep `/portal/events` as a `redirect()` so bookmarks and the e2e spec survive. |
| A6 | Notifications degrade to empty on the shared-dev adapter; bell always shows zero on dev. | `src/app/portal/layout.tsx:34-41` | Internal proxy route for feed/unread/mark-read (same pattern as A1's). |
| A7 | `updateProfileAction` calls `schema.parse()` — invalid input throws raw ZodError with no error boundary anywhere (B2), so members get the default Next crash screen. | `src/app/portal/profile/actions.ts:10` | `safeParse` + typed action result `{ ok, message, fieldErrors }`; pairs with B3. |

## B. UX gaps

| # | Finding | Where | Fix |
|---|---------|-------|-----|
| B1 | Zero `loading.tsx` in the whole app — every portal page is `force-dynamic`, so each nav is a blank wait. | all of `src/app` | Skeleton `loading.tsx` for portal root, calendar, retention, library, announcements, admin. |
| B2 | Zero `error.tsx` / `not-found.tsx` — thrown errors and bad URLs land on unstyled Next defaults. | all of `src/app` | Root + `/portal` error and not-found pages in brand style. |
| B3 | No feedback system: server-action forms (profile save, admin CRUD, retention record) give no success signal; only 2 of ~15 interactive components track pending state. Buttons stay active → double submits. | e.g. `src/app/portal/profile/page.tsx:80-96` | Sonner toaster in portal shell; convert forms to `useActionState` with the A7 result type; disable buttons while pending. Sweep module-by-module, not big-bang. |
| B4 | Guided tour copy assumes mobile ("bottom tabs", "+ button") but also shows on desktop where neither exists. | `src/app/portal/layout.tsx:18-27` | Breakpoint-aware steps or neutral copy. |
| B5 | Event check-in QR is unbranded — inconsistent with the member QR, which now carries the falcon badge. | `src/components/event-checkin-qr.tsx` | Extract the badge drawing from `member-code-card.tsx` into a small shared helper; apply to both. |
| B6 | Profile avatar is initials-only; no photo upload though R2 + uploads API exist. | `src/components/portal/member-avatar.tsx`, `src/app/api/uploads` | Optional avatar upload via existing storage proxy. Nice-to-have; last in queue. |

## C. UI / brand

| # | Finding | Where | Fix |
|---|---------|-------|-----|
| C1 | 10+ `PlaceholderBlock`s on the **public** site: homepage OD diagram, all service photos, all project galleries, contact map, article covers, product figures. Biggest visual-credibility gap; assets exist in `docs/[OSG 2425] Brand Manual…`. | `src/app/page.tsx`, `services`, `projects`, `contact`, `product/[slug]`, `public-page.tsx` | Export/source real images, replace placeholders, real `alt` text. Asset-gated — start the ask now, ship when assets land. |
| C2 | Dark-mode CSS vars exist but nothing toggles `.dark`. Dead weight either way. | `src/app/globals.css` | **Decision needed:** ship a toggle (next-themes) or delete the vars. Recommend delete — portal is navy-branded, dark mode doubles every visual QA pass. |
| C3 | Low-contrast body text on navy (`text-white/55`, `/65`) is borderline WCAG AA on hero, stats, signin. | `src/app/page.tsx:36`, signin | Bump body-size text to /70–/75; leave decorative labels. |

## D. SEO / metadata

| # | Finding | Fix |
|---|---------|-----|
| D1 | No `metadataBase`, no OpenGraph/Twitter cards anywhere; public pages have titles but no OG images. (Title template shipped in P0.) | `metadataBase` + OG defaults in root layout; per-page OG on public pages (`code-doc-cover.png` as starting asset). |
| D2 | No `sitemap.ts`, `robots.ts`, or `manifest.ts`. | Add all three; robots disallows `/portal`, `/api`, `/r`. |
| D3 | Portal pages have no titles — every tab reads "Ateneo CODE". | Static `metadata.title` per portal page; template does the rest. |

## E. Code health / quality

| # | Finding | Fix |
|---|---------|-----|
| E1 | E2e covers signin, links, RSVP/scan, retention only — nothing on announcements, library, surveys, profile, admin CRUD. | Add one spec per module as each phase ships it (not a separate test phase). |
| E2 | Shared-dev adapter gaps are papered over with scattered `.catch(() => …)` — these also swallow **real prod failures** silently. | Narrow catches to the adapter's "unavailable" error type; log anything else. |
| E3 | Copy-paste drift: `initialsFrom` ×3 (`layout`, `profile`, `events`), `EMPTY_SUMMARY` ×2 (`portal/page`, `profile/page`). | Fold into `src/lib/` when touching those files in P2 — not a standalone refactor. |

## Phased plan

Every phase ends with: `pnpm typecheck && pnpm lint && pnpm test`, e2e for touched flows, `graphify update .`.

### ✅ P0 — shipped this session
Member QR falcon badge (EC level H), root title template `%s · Ateneo CODE`, calendar Today button.

### P1 — correctness (½ day, no contract changes)
A2 term derive · A4 admin cards · A3 surveys index · A5 route rename+redirect · A7 safeParse.
**Done when:** scan panel shows correct current term; all admin pages reachable from dashboard; surveys discoverable from overview; `/portal/events` 307s to `/portal/retention`; bad profile input returns field errors instead of crashing.

### P2 — UX foundation (1 day)
B3 toasts + `useActionState` (profile first, then admin modules one at a time) · B1 loading skeletons · B2 error/not-found · B4 tour copy · B5 shared QR badge helper · E3 dedupe-as-you-touch.
**Done when:** every form shows pending + success/error; no route falls through to a default Next screen.

### P3 — nav pins end-to-end (1 day; touches schema + internal contracts)
A1 merge (migration drops `quick_links`, backfills `nav_pins`) · `listVisible()` · shared-dev proxy routes for navPins **and** notifications (A6, same pattern — do together) · wire layout · E2 narrow catches.
**Ceremony:** schema + contract changes → `pnpm db:migrate:dev` then `pnpm deploy:dev`; show exact `pnpm exec wrangler` commands and wait for approval before any migration runs (per CLAUDE.md).
**Done when:** an admin-created pin appears in a member's sidebar + menu sheet on shared dev; bell shows real unread count on dev.

### P4 — brand/content (asset-gated, parallel to P1–P3)
C1 real images · D1 OG cards · D2 sitemap/robots/manifest · D3 portal titles · C3 contrast pass · C2 dark-mode decision (recommend: delete vars).
**Done when:** zero `PlaceholderBlock` renders on `/`, `/services`, `/projects`, `/contact`; link previews show OG card.

### Deferred (revisit after P4)
B6 avatar upload · library "graph search" (per existing memory, out of v1).

**Order rationale:** P1 fixes silently-wrong behavior. P2 is the highest-leverage debt — every later feature inherits the toast/loading/error scaffolding. P3 last of the code phases because it alone carries migration + deploy ceremony and folds two half-features into one. P4 runs whenever assets arrive; nothing blocks on it.
**Risks:** A5 rename must keep the retention e2e spec green (update its URLs); B3 sweep is wide — land per-module commits so a bad conversion doesn't block the rest; A1 migration deletes a table — needs the approval gate and a seed-data update in the same PR.
