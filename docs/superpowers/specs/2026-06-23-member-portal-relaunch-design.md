# Member portal visual + feature relaunch — design

## Background

`design/member-*.jsx` and `design/admin-*.jsx` are finished static React mockups for the member workspace (`/portal/*`) that were never ported into `src/app/portal/`. Investigation found the gap is not purely cosmetic:

- **Visual-only gap** (backend already exists, only the UI is unstyled): Dashboard, Profile, Calendar, Events (RSVP/attendance), Links, Notifications. Backing tables already exist: `crsEvents`, `eventRsvps`, `crsAttendance`, `eventForumPosts`, `retentionRecords`, `surveys`/`surveyQuestions`/`surveyAssignments`/`surveyResponses`/`surveyAnswers`, `shortLinks`/`linkDailyStats`, `notifications`, `memberFeedState`.
- **New features with no backend at all**: Library (content repository with confidentiality gating, threaded moderated comments, saved lists/favorites), Announcements (pinned org posts), QR-based event check-in + live check-in feed + leaderboard, link analytics charts + QR customizer UI, admin guided tour (coachmarks).

This spec covers both, phased so the implementation plan can sequence low-risk work first.

## Non-goals

- No change to the public marketing site work in `2026-06-23-public-marketing-pages-design.md` — separate spec, separate review.
- No new icon library. The mockups use a hand-rolled SVG icon set (`design/kit.jsx`, `design/ui.jsx`); the real app already uses `lucide-react` consistently. We map mockup icons to the closest existing `lucide-react` icon rather than introducing a second icon system.
- No new design-token/CSS-variable layer. `src/app/globals.css` already defines `--primary` (navy) and `--accent` (mid blue) matching the mockups' `var(--navy)`/`var(--mid)`. Reuse existing Tailwind theme tokens and shadcn primitives throughout; do not port `design/tokens.css` verbatim.
- No new toast/notification library. No `sonner` or similar is installed. Where mockups show a `Toast`, use the existing inline success/error banner pattern already used in `src/app/portal/admin/quick-links/page.tsx`-style server-action pages.
- Survey *engine* (sampling math, question types, assignment-token flow) already exists server-side (`surveys`, `surveyQuestions`, `surveyAssignments`, `surveyResponses`, `surveyAnswers`) and has an admin page (`/portal/admin/surveys/[id]`) and a member page (`/portal/surveys/[id]`). This spec only restyles the member-facing survey UI to match `design/member-survey.jsx`'s stepped-form interaction; it does not change the data model or sampling logic.
- Admin role assignment already exists via `/portal/admin/roster` (`role:assign` permission). `design/admin-roles.jsx`'s table+modal is restyled onto the existing roster page; no new role-management route.
- Audit log already exists (`auditLogs` table, visible today only indirectly). This spec adds a dedicated `/portal/admin/audit` viewer page restyled from `design/admin-events-audit.jsx`'s `AuditLog` component, but does not change what gets audited.

## Phases

Each phase is independently shippable and reviewable. The implementation plan (written after this spec is approved) sequences them; phases 0–2 should land before 3–7 since later phases reuse the shell built in phase 1.

### Phase 0 — Favicon

- Replace `public/favicon.svg` with a new SVG built from the unmodified falcon artwork in `public/code-falcon-transparent.png`, fitted/padded inside the icon canvas (not cropped, recolored, stretched, outlined, or otherwise manipulated — `AGENTS.md` line 15: "Keep official logo colors intact. Do not recolor, stretch, crop, outline, shadow, or manipulate the logo.").
- Keep the existing `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` in `src/app/layout.tsx` — no format change needed.
- Add a maskable `public/icon.png` (192×192, falcon mark on navy `--primary` background) and reference it via `metadata.icons` in `src/app/layout.tsx` for home-screen/PWA install icons, since mobile users opening `/portal` from a phone home screen is the exact use case driving the FAB redesign below.

### Phase 1 — Shared portal shell (the FAB pattern)

This is the part the screenshots were about. `design/member-shell.jsx` already specs it almost exactly: a bottom sheet ("More") triggered from the tab bar, slide-up + scrim animation. Current `src/components/portal/portal-shell.tsx` has the same functional idea (a `Sheet` triggered from a 4th tab slot) but the trigger is a flat text button, not a raised circular button, and the sheet has no icon-per-row treatment.

**Mobile bottom nav, restyled:**
- 3 primary tabs (Overview/Calendar/Profile, unchanged from `primaryNav`) flank a **raised circular FAB** for "Menu", elevated above the bar (negative margin-top, `shadow-lg`, `bg-primary text-primary-foreground`, ~56px circle) — same layout idea as the reference screenshots, but in CODE's navy/accent palette instead of red.
- Tapping the FAB opens a `Sheet` (`side="bottom"`) listing every item from `sheetNav` (today: just Notifications) plus the new items this relaunch adds: Library, Announcements, Links, Admin, Profile settings, Sign out — each row gets an icon + label + chevron, matching `design/member-shell.jsx`'s `NAV_SECONDARY`/`NAV_FOOT` row treatment. The "Admin" row uses the same per-module `can(actor, action)` filtering as `/portal/admin`'s existing `modules` array (`src/app/portal/admin/page.tsx`) — shown only if the actor passes at least one admin permission check, not a hardcoded role check. The secondary-nav list itself is a plain array (mirroring `sheetNav`'s shape), not hardcoded JSX, so Phases 3/4/7 add their new items (Announcements, Library, Audit log) by appending to that array rather than touching the shell component again.
- Animation: no new dependency needed — `src/components/ui/sheet.tsx` already wires `data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom` / `data-[state=closed]:animate-out` for `side="bottom"`, which is exactly the slide-up + scrim-fade effect in the reference screenshots. FAB itself gets a `active:scale-95 transition-transform` press effect.
- Desktop is unaffected in structure (sidebar rail already exists in `portal-shell.tsx`) but gets the same visual polish pass: active-item left accent bar (`design/member-shell.jsx`'s `RailItem`), `ADMIN` pill badge on the admin nav item.

**Shared components to build** (`src/components/portal/`):
- `notification-bell.tsx` — bell icon + unread-count badge + popover (desktop) / sheet (mobile), replacing the current plain `/portal/notifications` page link with an inline panel; the full notifications page stays as a fallback "view all" destination.
- `empty-state.tsx` — icon + message + optional action button, dashed border, used by Library/Announcements/Links/Events empty states instead of ad hoc markup per page.
- `member-avatar.tsx` — initials-based avatar (no new avatar image upload needed; data already has `displayName`).

### Phase 2 — Reskin existing pages (no schema change)

Apply the shared shell + Tailwind/shadcn styling from the mockups to pages that already work functionally:

- **Dashboard** (`/portal`, currently a thin overview) — port `design/member-dashboard.jsx`'s retention widget, announcements digest (once Phase 3 ships; until then, omit that section), events strip, library activity (once Phase 4 ships; until then, omit), notifications panel. Mobile: vertical stack. Desktop: 2-column grid.
- **Profile** (`/portal/profile`) — port `design/member-profile.jsx`'s header (avatar, name/pronouns/batch/dept), retention strip, stats row (events/points/links/articles — articles count is 0 until Phase 4), info card, edit form. Other-member read-only view reuses the same components.
- **Calendar** (`/portal/calendar`) — port `design/member-calendar.jsx`'s month grid + agenda toggle, type-colored dots/pills, event-peek modal on click.
- **Events** (`/portal/events`) — port `design/member-events.jsx`'s card layout (date box, type/organizer/approval badges, attendance bar, capacity counter) for the existing RSVP flow.
- **Links** (`/portal/links`) — port `design/member-links.jsx`'s table/card layout, slug-availability validation feedback, copy-button success state.
- **Notifications** (`/portal/notifications`) — becomes the "view all" page behind the new bell panel; reskin list rows to match `design/member-shell.jsx`'s `NotifPanel`.

### Phase 3 — Announcements (new feature)

**Schema** (new tables in `src/db/schema.ts`):
```
announcements (
  id, tag ("OSG"|"CRS"|"Publishing"|...), title, body (text, plain — see rendering rule below),
  pinned (boolean, default false), audience (text, default "all" — free-text display label only,
    e.g. "All members"; not enforced via permission filtering in this version, every signed-in
    member sees every announcement regardless of this field's value),
  createdBy -> members.id, createdAt, updatedAt,
  linkedEventId -> crsEvents.id (nullable, set null on delete),
)
announcement_reads (
  announcementId -> announcements.id, memberId -> members.id, readAt,
  primary key (announcementId, memberId)
)
```
Indexes: `announcements_pinned_idx` (pinned, createdAt desc), `announcement_reads_member_id_idx`.

**Role/permission**: add `"publishing"` to `roleKeys` (alongside the existing minimal roles `calendar`/`link`/`retention`), with `rolePermissions.publishing = ["announcement:manage"]`. This mirrors the existing pattern (one role per content domain) rather than overloading `member_admin`. Requires a migration-inserted `roles` table row, same as the `public_content_admin` row from the public-pages spec.

**Pages**: `/portal/announcements` (member feed — pinned section + chronological rest, restyled from `design/member-announcements.jsx`'s `AnnouncementsModule`/`AnnCard`/`AnnDetail`), `/portal/admin/announcements` (compose/edit/pin, restyled from `AnnCompose`, gated on `announcement:manage`, following the quick-links `page.tsx`+`actions.ts` server-action pattern).

**Rendering rule** (carried over from the public-pages spec's same finding): body is stored and rendered as plain text split into paragraphs, never `dangerouslySetInnerHTML`. The mockup's `body` array with inline `<b>` tags is **not** reproduced — bold emphasis is dropped in favor of plain paragraphs, consistent with the no-HTML-rendering rule.

### Phase 4 — Library (new feature, largest in this spec)

**Schema**:
```
library_items (
  id, kind ("article"|"case_study"), confidentiality ("public"|"members"|"confidential"),
  category, title, dek, readMinutes, abstract, sectionsJson (array of {heading, body}),
  componentsJson (array of {name, definition, example}), questionsJson (array of strings),
  referencesJson (array of strings), topicsJson (array of strings),
  createdBy -> members.id, publishedAt, updatedAt,
)
library_comments (
  id, libraryItemId -> library_items.id, memberId -> members.id, parentId (self-ref, nullable),
  anonymous (boolean), body, hidden (boolean, default false — moderation soft-delete), createdAt,
)
library_favorites ( memberId -> members.id, libraryItemId -> library_items.id, primary key both )
library_lists ( id, memberId -> members.id, name, color, createdAt )
library_list_items ( listId -> library_lists.id, libraryItemId -> library_items.id, primary key both )
```
JSON columns follow the existing `text(..., { mode: "json" })` convention (first used here and in the public-pages `orgProfile`/`services` tables — same pattern, same `|||`/one-per-line admin-form convention for editing array fields).

Indexes: `library_items_category_idx`, `library_items_published_at_idx`, `library_comments_library_item_id_idx`. (`library_favorites` and `library_list_items` need no separate index beyond their composite primary keys — `memberId`/`listId` is the leading PK column in each, so "my favorites" / "items in this list" lookups are already served by the PK index; an extra single-column index on the same leading column would be redundant.)

**Permissions**: `publishing` role (from Phase 3) also gets `"library:manage"` (create/edit items) and `"library:moderate"` (hide/unhide comments). Reading is permission-gated per row, not per role: `confidentiality: "public"` items are visible to any signed-in member; `"members"` items require an authenticated member (no extra role); `"confidential"` items are gated behind a request-access flow — clicking "Request access" inserts a row into the existing `notifications` table targeted at every member holding `library:manage` (no new request-queue table), and the actual access grant is still a manual `library:manage` action elsewhere (edit the item's confidentiality or a future per-member grant list — out of scope here). Defer a formal request-tracking table if usage shows the notification-only flow isn't enough.

Comment `anonymous` only hides the author's identity from other members in the rendered UI — `memberId` is always stored and always visible to anyone with `library:moderate`, and moderation actions go through `audit.record()` like every other mutation in this codebase, so anonymity never weakens the audit trail.

Library items have no draft/staging workflow in this version: a `library_items` row is visible to qualifying readers as soon as it's created. `publishedAt` is a display/sort timestamp, not a status gate.

**Pages**: `/portal/library` (browse, grid/list toggle, filters — restyled from `member-library.jsx`), `/portal/library/[id]` (full article anatomy + comments — restyled from `member-library-detail.jsx`), `/portal/library/lists` (favorites + saved lists — restyled from `member-library-lists.jsx`), `/portal/admin/library` (CRUD, gated on `library:manage`).

**Deferred from the mockup**: the natural-language "relationship-aware" search box in `LibBrowse` is replaced with a plain title/topic substring filter — no embeddings/AI search in this version. The `RelatedRow` "related items" graph is computed from shared `topicsJson` overlap (simple intersection), not a real graph traversal.

### Phase 5 — Event QR check-in, live feed, leaderboard

No new tables — `crsAttendance.scannedBy` already implies an admin-scans-member model. **This phase is not greenfield**: a static-QR check-in system already exists (`src/components/member-code-card.tsx` renders a permanent `code:m:<memberId>` QR via the already-installed `qrcode` package; `src/components/event-scan-panel.tsx` + `POST /api/events/[id]/scan` + `GET /api/events/[id]/members` let an organizer scan or manually search/mark a member present, writing to `crsAttendance` via `repositories.events.recordScan`). This phase extends that system rather than building a parallel one:

- **Member side**: the existing event-detail route `/portal/calendar/[eventId]` (there is no `/portal/events/[id]` route today — `events/page.tsx` is list-only; `calendar/[eventId]/page.tsx` is the one existing per-event detail page) shows a QR code encoding a short-lived signed token (HMAC-SHA256 of `memberId:eventId:expiry`, keyed by a purpose-labeled derivation of `AUTH_SECRET` — e.g. `HMAC(AUTH_SECRET, "checkin:" + payload)`, never the raw session-signing key reused directly — ~5 min expiry, not a DB-stored token), **in addition to** the existing permanent member-code QR on the profile page — the two are different artifacts: the profile QR is "this is who I am" (long-lived, today's existing flow), the event-page QR is "I am here, right now" (short-lived, new this phase). Restyled from `member-events-detail.jsx`'s member-side panel ("Window is open" / checked-in state). Accepted risk: a member who screenshots/shares their event QR lets someone else check in as them within the 5-minute window — same trust model as the paper/badge check-in it replaces, not a new gap; not mitigated further in this version.
- **Admin/organizer side**: full-screen scanner page restyled from `design/member-events-scan.jsx`. It posts to the **existing** `POST /api/events/[id]/scan` route, extended to accept either payload shape: the existing `code:m:<memberId>` static code (looked up as today) or the new signed event token (verified for HMAC + expiry, then the embedded `memberId` is used the same way). Extending the existing route — rather than adding a new one — means it keeps `assertSameOrigin`, the existing `enforceRateLimit` call, and critically the existing `APP_ENV === "shared"` → `proxySharedApiRequest(...)` branch for free: token verification (which needs `AUTH_SECRET`, optional when `APP_ENV=shared` per `src/server/env.ts`) only ever runs in the non-shared/owning environment the request gets proxied to, exactly like the rest of this route already works. `recordScan` already calls into the repository layer; add `audit.record()` there alongside it so attendance scans show up in the Phase 7 audit log viewer (today's `recordScan` does not appear to audit-log — confirm during implementation and add if missing). The existing `EventScanPanel` manual-search fallback is unchanged and stays as the no-camera/scan-fails path.
- **Live check-in feed**: organizer view polls (no websockets — consistent with the rest of the app having no realtime infra) a new Route Handler `GET /portal/calendar/[eventId]/attendance/route.ts` every 5s while the scan window is open, rendering the last 5 check-ins, restyled from `useLiveCheckins`/`AttendancePanel`. This route is genuinely new (no existing analog), so it must follow the same shared-mode pattern as `GET /api/events/[id]/members`: branch on `APP_ENV === "shared"` and call `proxySharedApiRequest(...)` rather than reading the DB directly. (A Route Handler is required here, not a Server Action — this is a polled JSON fetch from a client component, and it lives at a deeper path segment than the `[eventId]` page itself so it doesn't conflict with that page's own `page.tsx`.)
- **Leaderboard**: `/portal/events` gets a "Leaderboard" tab — aggregate query over `retentionRecords.points` grouped by member, scoped to current `term` (existing `terms` table) and all-time, restyled from `member-events.jsx`'s leaderboard tab. Read-only, no new schema.

### Phase 6 — Link analytics + QR customizer

No new tables — `linkDailyStats` already accumulates daily counts **and** referrer/device buckets (`referrerBucket`/`deviceBucket` columns; `repositories.links.getStats()` already aggregates both into `byReferrer`/`byDevice` maps server-side — verified in `src/db/repositories/links.ts`). Adds `/portal/links/[id]`:
- Bar chart of `linkDailyStats` over time, plus referrer and device breakdown charts, all sourced from the existing `getStats()` return value (restyled from `member-links-detail.jsx`'s `BarChart`/`Stat`). No new aggregation logic needed — this phase is UI-only on top of data the repository already computes.
- QR customizer: light/dark/transparent SVG variants of the existing short-link's destination, generated with the already-installed `qrcode` package (`package.json` already depends on `qrcode`/`@types/qrcode` — no new dependency) — not a hosted QR API, so links work offline/without third-party calls.

### Phase 7 — Admin guided tour + audit log viewer

- **Guided tour**: coachmark overlay (spotlight cutout via `box-shadow`, tooltip, step counter, Back/Next) restyled from `design/admin-tour-settings.jsx`. Tracks completion by adding a `tourSeenAt` column to the existing `memberFeedState` table (reusing the table rather than creating a new one, consistent with its existing `surveysSeenAt`/`eventsSeenAt` columns). Steps are hardcoded per role (`TOUR_MEMBER`, `TOUR_ADMIN`), not admin-configurable.
- **Audit log viewer**: `/portal/admin/audit`, restyled from `admin-events-audit.jsx`'s `AuditLog` (category filter, timeline). Reads the existing `auditLogs` table; no new write path.

## Schema change summary

New tables (7): `announcements`, `announcement_reads`, `library_items`, `library_comments`, `library_favorites`, `library_lists`, `library_list_items`, plus one altered table (`memberFeedState` gets a new nullable `tourSeenAt` column — additive, no migration risk to existing rows).

New role: `"publishing"` added to `roleKeys` in `src/server/auth/permissions.ts`, with a corresponding `roles` table row inserted by the migration (same requirement verified against the public-pages spec's round-1 finding — TS union alone is not a real grant).

New permissions: `"announcement:manage"`, `"library:manage"`, `"library:moderate"`.

`AuditCategory` (`src/db/repositories/audit.ts`) is a closed TS union `"role" | "event" | "retention" | "survey" | "link" | "member"`, not an open string — `category` is `text(...).$type<AuditCategory>()` with no DB-level CHECK constraint, so widening it is a code-only change (no migration). Add `"announcement"` and `"library"` to the union so Phase 3/4 mutations (`announcement:manage`, `library:manage`, `library:moderate` actions) can call `audit.record()` without falling outside the allowed category set.

## Rendering & security rules (carried over, restated for this spec's reviewers)

- Never `dangerouslySetInnerHTML` for admin/member-authored text (announcements, library abstracts/sections, comments). Plain JSX paragraph rendering only.
- QR check-in tokens are short-lived signed strings, not bearer tokens stored verbatim anywhere — verified server-side on scan, never trusted client-side.
- Comment moderation (`library:moderate`) is a soft-delete (`hidden` flag), preserving the row for audit purposes — consistent with how the rest of this codebase favors `auditLogs` over hard deletes for moderated content.

## Migration & seeding

Single migration adds the 7 new tables + the `memberFeedState.tourSeenAt` column + the `publishing` roles-table row. Dev seed data (`src/db/seed/data.ts`) gets representative rows for `announcements` (2-3) and `library_items` (3-5, mirroring `design/member-library-data.jsx`'s sample set) so the new pages aren't empty in dev/beta.

## Deployment

Same path as every schema change in this repo, shown for explicit approval before running:
```
pnpm exec wrangler d1 migrations apply DB --env dev --remote
```
followed by `pnpm deploy:dev`.

## Explicitly deferred (not in this spec, may need a future one)

- AI/embedding-based "relationship-aware" library search.
- Confidential-library-item access *request* tracking (currently a manual grant).
- Admin-configurable tour steps.
- Real-time (websocket) check-in feed.
