# Events & Points — Admin Monitoring, Late Tracking, Retention De-specialization

Date: 2026-07-30
Status: Revision 2 (incorporates Codex reviews R1 + R2 and the confirmed design brief)
Branch: `beta`
Migrations: `0014` (additive, pre-deploy) and `0015` (destructive, post-deploy)

## Problem

The events & points system works but is hard to operate.

**Admin side.** `/portal/admin/data` is a single page with four stacked slabs: a metric row,
an events table, an attendance detail table for one selected event, and a global points ledger.
The page answers "who came to this event" and nothing else. It cannot answer:

- Which events has this member attended?
- Who arrived late, to any event, ever?
- Who scanned this person in?
- Which approved events ended with zero attendance?

**Performance.** `src/app/portal/admin/data/page.tsx` loads every attendance row and every point
record for the whole school year and serializes them into a client component, which filters in the
browser. At 200 events x 60 members that is roughly 12,000 rows per page load, with no pagination.
The UI shape mirrors the loading strategy: because all data is already client-side, the cheapest
render was "three big tables." Fixing the IA without fixing the loading just moves the dump around.

**Scanner activation.** `EventScanPanel` renders last on the member dashboard
(`src/app/portal/page.tsx:143`), below metrics, announcements, and library. A scanner standing at a
door has to scroll past everything to find it.

**Scan accountability.** `crs_attendance.scanned_by` is recorded and `event:scan_attendance` /
`event:undo_scan` are audited, but neither is displayed anywhere. There is no way to answer "who let
this person in" without SQL.

**Retention.** Retention is modelled as a cross-cutting property (`point_types.counts_toward_retention`)
rather than a point type. The consequences leak everywhere: a discriminated union in the leaderboard
repo, a save-time validator that refuses any configuration without an active retention-counting type,
a `Retention` badge in the point-types manager, and a member-facing page titled "Retention" that is
really the points page.

## Goals

1. Retention becomes an ordinary point type that always exists and cannot be retired.
2. Attendance records lateness, defined per event.
3. Admin can pivot attendance three ways: by event, by member, by scan.
4. Scanners are told they can scan, at the top of their dashboard, and can undo their own mistakes.
5. Every admin query is bounded — filtered and paginated server-side.
6. Undoing a scan leaves a visible trace.

## Non-goals

- Renaming the `retention_records` table or `retention.ts` repository. The table is the generic
  points ledger and the name is wrong, but renaming touches every import for zero functional gain.
  User-facing copy carries the fix instead. Logged under "Known debt".
- Reworking the member-facing events/calendar UI beyond the retitle in §1.
- Attendance for non-members / guests.
- Notifications, push, or email for scanner activation. Dashboard placement only.
- Enabling undo in shared development mode. See §6.

## Locked decisions

| Decision | Choice | Rejected |
|---|---|---|
| Retention semantics | Drop `counts_toward_retention`. Retention progress = sum of records whose `point_type_id = 'pt_retention'`. | Keeping the flag with multiple contributing types; pooling all types into one total. |
| Lateness | Per-event `grace_minutes`, nullable, default 15. Status derived at read time, never stored. | Global-only setting; grace on `event_type_rules`. |
| Member profile location | New route `/portal/admin/members/[id]`. | Tab inside Events & Points; side drawer from member names. |
| Admin IA | Section with sibling routes (Overview / Events / Members / Scan log / Ledger). | Single page with drawers; pushing rosters onto `/portal/calendar/[eventId]`. |
| Scan log source | `audit_logs`, extended with `target_member_id`, queried directly by `attendance-reports.ts`. | Reading `crs_attendance` (shows current state, not history); a new `event_scan_events` table; soft-deleting attendance; routing through `audit.list`. |
| Shared-dev support for the admin section | Out of scope. It already throws today. | Building contract + internal handler + adapter entries for five new read models. |
| Migration shape | Two migrations either side of the code deploy. | One migration containing both the add and the drop. |
| Status encoding | Exception-first: on-time silent, late shows the delta, absent dims the row. | Traffic-light badges — the brand palette has no red/amber/green. |

---

## §1 — Retention de-specialization

### Migration shape

The naive single migration is unsafe in both directions. Deploy order is
`pnpm db:migrate:dev` then `pnpm deploy:dev` (per `CLAUDE.md`), so a migration lands while the
previous code is still serving. Dropping `counts_toward_retention` in that window breaks the running
code, which still selects it.

Split either side of the deploy:

**`0014` — additive only, safe before the deploy:**

```sql
ALTER TABLE crs_events ADD COLUMN grace_minutes INTEGER;
ALTER TABLE audit_logs ADD COLUMN target_member_id TEXT REFERENCES members(id) ON DELETE SET NULL;
CREATE INDEX audit_logs_target_member_created_idx ON audit_logs (target_member_id, created_at);
CREATE INDEX audit_logs_action_created_idx ON audit_logs (action, created_at);

-- Backfill the member id that scan/undo rows currently bury in free-text detail.
UPDATE audit_logs
SET target_member_id = substr(detail, 8)
WHERE category = 'event'
  AND action IN ('event:scan_attendance', 'event:undo_scan')
  AND detail LIKE 'member=%';
```

Old code ignores unknown columns, so `0014` is safe to apply at any time.

The physical columns are not enough. `src/db/schema.ts` is the only schema source, so the same change
adds `targetMemberId` and both indexes to the `auditLogs` table definition (`schema.ts:523-542`) and
`graceMinutes` to `crsEvents` (`schema.ts:190-218`). Without the Drizzle fields, `AuditInsert`,
`auditInsertValues`, and every filter predicate cannot reference the columns at all.

**Code deploy** — `schema.ts` removes `countsTowardRetention` from the Drizzle table definition and
every read switches to `pt_retention`. The physical column still exists and is simply never
referenced.

**`0015` — destructive, safe only after the deploy:**

```sql
ALTER TABLE point_types DROP COLUMN counts_toward_retention;
```

By the time this runs, no deployed code references the column. Nothing breaks in the window because
there is no window.

`DROP COLUMN` requires SQLite 3.35+ and fails on a column referenced by an index, view, or
partial-index `WHERE`. `counts_toward_retention` carries no index in `schema.ts`. If D1's SQLite
rejects it anyway, `0015` falls back to the table rebuild used in
`0013_additive_points_schema.sql`: create `point_types_new` without the column, `INSERT ... SELECT`,
drop, rename. `0015` is cosmetic cleanup and can be deferred indefinitely without blocking the
feature — that is the point of the split.

### Constants

New file `src/lib/point-types.ts`:

```ts
export const RETENTION_POINT_TYPE_ID = "pt_retention";
export const DEFAULT_GRACE_MINUTES = 15;
```

### Repository changes

Every `eq(pointTypes.countsTowardRetention, true)` predicate becomes
`eq(retentionRecords.pointTypeId, RETENTION_POINT_TYPE_ID)`:

- `src/db/repositories/retention.ts:167` — `memberTermSummary`
- `src/db/repositories/retention.ts:202` — `leaderboard`
- `src/db/repositories/retention.ts:217` — `publicLeaderboard`
- `src/db/repositories/retention.ts:373` — `myHistory` totals
- `src/db/repositories/overview.ts:59` — dashboard retention metric

Where the predicate was the only reason for the `pointTypes` join, drop the join.

Delete the `PublicLeaderboardSelection` discriminated union
(`src/db/repositories/retention.ts:51-56`). `publicLeaderboard` takes a plain
`pointTypeId: string`. Retention is one option among many in the dropdown.

`src/app/portal/profile/point-breakdown.ts:24` derives a `retention: boolean` per type from the
flag; it becomes `type.id === RETENTION_POINT_TYPE_ID`.

`src/db/repositories/pointTypes.ts` drops `countsTowardRetention` from `PointTypeRow`,
`PointTypeUpsertInput`, the select list (`:45`), both write paths (`:69`, `:104`), and the
last-retention-type guard at `:88-97`, which the permanence rule below replaces.

### Permanence

One guard: `upsertType` rejects setting `active = false` on `pt_retention`. Error:
`"The Retention point type cannot be retired."`

The other two-thirds of "always there and permanent" are already guaranteed and need no new code:

- **Key changes** are blocked for every type at `pointTypes.ts:86`
  (`"Point type keys cannot be changed."`).
- **Deletion** is impossible — `PointTypesRepository` exposes only `list` and `upsertType`
  (`pointTypes.ts:32-35`). There is no delete path to guard.

`label` and `position` stay editable. Enforced in the repository, not only the action, so no other
caller can bypass it.

This guard replaces the `exists(...)` sub-select at `pointTypes.ts:88-101`, which enforced the old
"at least one active type counts toward retention" rule and dies with the flag.

This replaces the validator at `src/app/portal/admin/system/point-types/input.ts:50`
("At least one active point type must count toward retention"), meaningless once the flag is gone.

### Callers to update beyond the repositories

Direct hits on the flag, all of which must change:

- `src/db/seed/data.ts:42-44` — drop the flag from all three seeded types.
- `src/db/seed/data.test.ts:23,:25` — assertions on the seeded flag.
- `scripts/verify-points-upsert-local.ts:22` — a standalone script, easy to miss, outside `src`.
- `src/app/portal/admin/system/point-types/actions.ts:19` — the retention-first ordering pass.
- `src/app/portal/admin/system/point-types/input.ts` + `input.test.ts:12` — the `retentionIds` field,
  the last-retention-type validator, and their tests.
- `src/app/portal/events/page.tsx:44` — the comment describing aggregate semantics.
- `src/app/portal/profile/point-breakdown.ts:24` and `point-breakdown.test.ts:5,:37,:47,:55`.
- `src/app/portal/calendar/[eventId]/award-editor-input.test.ts:9`.
- `src/db/repositories/overview.integration.test.ts:35`.
- `src/db/repositories/events.integration.test.ts:63,:70,:122`.
- `src/db/additive-points-schema.integration.test.ts:16` and
  `src/db/repositories/pointTypes.integration.test.ts:12`.

Surfaces that need a **manual check but contain no direct hit** — do not expect the search to find
these:

- `src/db/contract/retention.ts` and `src/db/contract/events.ts` carry neither the flag nor the
  leaderboard union. `publicLeaderboard` is not in the contract at all; only `leaderboard` is
  (`contract/retention.ts:94`). See the shared-mode note below.
- `src/db/repositories/retention-unavailable.ts:11` maps `publicLeaderboard` to `unavailable`. Its
  signature must still match the new one so the file typechecks.
- `src/app/portal/admin/data/exports/page.tsx` exports **xlsx**, not CSV, and names no point type
  directly. Verify its columns by reading it; the search will not flag it.

**Completion gate.** The naive `rg "countsTowardRetention|counts_toward_retention"` can never return
zero, because this spec document contains the terms. Scope it:

```bash
rg -n "countsTowardRetention|counts_toward_retention" src scripts
```

Expect zero hits. `drizzle/migrations/0013_additive_points_schema.sql` legitimately retains the term
as historical SQL and is outside those paths.

### Shared mode and the leaderboard

`publicLeaderboard` has no contract operation, so in shared development it resolves to
`retention-unavailable.ts`'s throwing stub, and `/portal/events` swallows the throw via
`.catch(() => [])` (`page.tsx:57`) into an empty leaderboard. That is today's behaviour. Replacing
the `PublicLeaderboardSelection` union with a plain `pointTypeId` neither fixes nor worsens it — the
stub simply has to keep matching the signature. Adding a real contract operation is out of scope and
logged under "Known debt".

### UI

- `point-types-manager.tsx`: remove the `countsTowardRetention` checkbox (lines 43-46, 173-181) and
  the `Retention` badge (line 134). The `pt_retention` row shows a lock icon and a disabled retire
  toggle, with title text explaining why.
- `src/app/portal/events/page.tsx`: title `Retention` → `Points`. Tabs `My history` / `Leaderboard`
  → `My points` / `Leaderboard`. The point-type filter, currently leaderboard-only, also applies to
  the history tab.
- `src/app/portal/page.tsx`: `MetricCard label="Retention"` stays. It names the point type, which is
  now accurate rather than special.

### Migration risk

If any point type other than `pt_retention` currently has `counts_toward_retention = 1`, its points
silently stop counting toward retention. Seed data has only `pt_retention` set, but dev and
production D1 must be checked. See "Pre-flight".

---

## §2 — Late tracking

### Schema

`crs_events.grace_minutes INTEGER` nullable (added in `0014`). `NULL` means use
`DEFAULT_GRACE_MINUTES`.

### Derivation

New pure module `src/lib/attendance-status.ts`:

```ts
export type AttendanceStatus = "on_time" | "late";

export function attendanceStatus(
  scannedAt: Date,
  startsAt: Date,
  graceMinutes: number | null,
): AttendanceStatus {
  const grace = (graceMinutes ?? DEFAULT_GRACE_MINUTES) * 60_000;
  return scannedAt.getTime() > startsAt.getTime() + grace ? "late" : "on_time";
}

/** Whole minutes past the grace window; 0 when on time. Drives the "+12 min" chip. */
export function minutesLate(
  scannedAt: Date,
  startsAt: Date,
  graceMinutes: number | null,
): number {
  const grace = (graceMinutes ?? DEFAULT_GRACE_MINUTES) * 60_000;
  const over = scannedAt.getTime() - startsAt.getTime() - grace;
  return over > 0 ? Math.floor(over / 60_000) : 0;
}
```

Status is computed at read time, never persisted. If an organizer corrects a wrong `starts_at` or
adjusts the grace window, every historical flag self-corrects. Persisting would freeze bad data and
require a backfill on every correction.

`CHECKIN_LEAD_MS` (30 min, `src/db/repositories/events.ts:28`) already permits scanning before
`starts_at`, so `scannedAt < startsAt` is normal and yields `on_time` with no special branch.

`minutesLate` measures from the end of the grace window, not from `starts_at`, so "+1 min" means one
minute past the point where lateness began. Measuring from `starts_at` would make every late arrival
read as at least `grace` minutes late, which is wrong and confusing.

### Third state: absent

`RsvpState` is `"going" | "none"` (`src/db/schema.ts:10`). **Absent** = an `event_rsvps` row with
`state = 'going'` and no `crs_attendance` row. Derived from existing tables, no schema change.

Members who never RSVP'd and never attended are not absent — they are simply not in the roster.
`event_invites` is deliberately not used: an invitation is not a commitment, and treating invitees as
expected attendees would mark most of the org absent for every event.

### UI

`grace_minutes` gets a number input labelled "Grace period (minutes)" with placeholder `15` in:

- `src/app/portal/calendar/create-event-sheet.tsx`
- `src/app/portal/calendar/[eventId]/event-manage-panel.tsx`

Blank submits `NULL`. Validation: integer, `0 <= n <= 240`.

### Tests

`src/lib/attendance-status.test.ts` — exactly at `startsAt + grace` is `on_time`; one ms past is
`late`; a scan before `startsAt` is `on_time`; `null` grace uses the default; `minutesLate` returns
0 when on time and floors correctly just past the boundary.

---

## §3 — New repository: `attendance-reports.ts`

`src/db/repositories/events.ts` is already 731 lines. The cross-cutting reporting queries go in a
new file, `src/db/repositories/attendance-reports.ts`, with one purpose: bounded read models for the
admin console. It owns no writes.

### Data access convention

It takes a `Db` handle from `getDb()` directly and is **not** registered in
`createDrizzleRepositories` / `createSharedRepositories`. This matches the code it replaces:
`src/app/portal/admin/data/retention/data.ts:19,:80` and
`src/app/portal/admin/data/exports/page.tsx:18` already call `getDb()` directly.

The consequence is deliberate and worth stating plainly. `getDb()` **throws** in shared mode —
`"Shared mode uses HTTP repositories, not a local Drizzle client."` (`src/db/client.ts:18`) — so the
admin Events & Points section does not function in shared development **today**, before any of this
work. Following the existing convention keeps that unchanged; it does not introduce a regression.

Making the section work in shared dev would mean a contract module, an internal handler, a route
export, adapter requests, repository wiring, and parity tests for five read models. That is a
pre-existing gap, materially larger than this feature, and repairing it here would be scope
expansion. It is logged under "Known debt" instead.

| Function | Input | Returns |
|---|---|---|
| `termEventSummaries` | `actor, termId` | per event: `id, title, type, status, startsAt, place, graceMinutes, attendedCount, lateCount, absentCount, pointsIssued` |
| `eventRoster` | `actor, eventId` | per member: `memberId, fullName, email, rsvpState, scannedAt \| null, scannedById, scannedByName, pointsEarned[]` |
| `termMemberSummaries` | `actor, termId, { q?, limit, offset }` | per member: `memberId, fullName, email, eventsAttended, lateCount, pointsByType[]` |
| `memberAttendance` | `actor, memberId, termId` | rows: `eventId, title, startsAt, graceMinutes, scannedAt \| null, rsvpState, pointsEarned[]` |
| `scanLog` | `actor, termId, { eventId?, scannerId?, memberId?, limit, offset }` | rows: `at, action, memberId, memberName, eventId, eventTitle, eventStartsAt, graceMinutes, actorMemberId, actorName` |

All require `retention:record`. All return `graceMinutes` + `startsAt` so the caller derives status
via `attendanceStatus` rather than duplicating the rule in SQL.

`limit` defaults to 50, hard-capped at 200. `q` matches `members.full_name`, `members.name`,
`members.email` case-insensitively.

`scanLog` reads `audit_logs`, not `crs_attendance` — see §4. `lateCount` in the summaries is computed
in SQL against `starts_at + coalesce(grace_minutes, 15) * 60000` for aggregate counts; the per-row
badge still uses the shared TS function. The duplication is deliberate and narrow (a single
comparison), and `attendance-reports.integration.test.ts` asserts the two agree on a seeded fixture
so they cannot drift silently.

`loadAttendance` in `src/app/portal/admin/data/retention/data.ts` is deleted — `termEventSummaries`
and `eventRoster` replace it. `loadRetentionPickers` stays; it feeds `ManualRecordSheet`.

### Tests

`src/db/repositories/attendance-reports.integration.test.ts`, Workers pool, `.ts` only, no jsdom.
Covers: permission denial for a non-`retention:record` actor; late/absent counting against a seeded
event; SQL `lateCount` agrees with `attendanceStatus`; `q` filter; `limit` cap enforcement;
`scanLog` surfaces an undone scan.

---

## §4 — Admin information architecture

`/portal/admin/data` becomes a section. Each route loads only its own data and states the question
it answers.

### Routes

| Route | Question it answers |
|---|---|
| `data/page.tsx` | **Overview** — what needs my attention this term? |
| `data/events/page.tsx` | **Events** — how did each event turn out? |
| `data/events/[id]/page.tsx` | **Event roster** — who attended, and who was late? |
| `data/members/page.tsx` | **Members** — who is participating, and who is short? |
| `data/scans/page.tsx` | **Scan log** — what happened at the door, and who did it? |
| `data/ledger/page.tsx` | **Ledger** — where did every point come from? |

`src/app/portal/admin/data/retention/page.tsx` (a bare redirect) is deleted.
`events-points-dashboard.tsx` is decomposed across the new routes and removed.

### Overview

- Metric row: events, check-ins, points issued, manual records (existing `summarizeDashboard`).
- **Needs attention** — three lists, each capped at 5 with a "see all" link:
  - approved events that have ended with zero attendance
  - events with `event_point_awards` configured but zero scans
  - members below `terms.probation_below` for the selected term
- Last 5 scan-log entries.

The "needs attention" block is why the overview exists. A metric row alone does not justify a page.

### Event roster (`data/events/[id]`)

Header: title, date, place, type, grace period, counts.
Attendee table: member, scanned at, status, **scanned by**, points awarded from this event.
Absent members collapse behind a `Show 14 absent` disclosure below the attendee table (see §7).

### Scan log (`data/scans`) — sourced from `audit_logs`

A log that reads current state is not a log. `crs_attendance` answers "who is currently marked
present"; `undoScan` deletes from it, so a reversed scan leaves no trace there. The scan log
therefore reads `audit_logs`, filtered to `category = 'event'` and
`action IN ('event:scan_attendance', 'event:undo_scan')`.

This requires one change to the audit layer, plus a query that bypasses it:

1. **`audit_logs.target_member_id`** — the scanned member is currently buried in free-text `detail`
   as `member=<id>`, which cannot be indexed or filtered. The new nullable column is added to the
   Drizzle definition in `schema.ts`, populated going forward via a new optional
   `AuditRecordInput.targetMemberId` mapped in `auditInsertValues` (`audit.ts:46-57`), and backfilled
   for existing rows by `0014`. `detail` stays as-is for compatibility.

   The backfill's `substr(detail, 8)` is correct for the literal written at
   `events.ts:627` — `` detail: `member=${input.memberId}` ``. `member=` is 7 characters and SQLite's
   `substr` is 1-indexed, so position 8 is the first character of the id. The `action IN (...)` and
   `detail LIKE 'member=%'` guards keep other `category = 'event'` actions with different detail
   formats out of the update.

2. **`scanLog` queries `auditLogs` directly**, in `attendance-reports.ts`, under its own
   `retention:record` gate. It does **not** route through `audit.list`.

   `audit.list` gates on `hasAnyAdminScope` (`audit.ts:67`), which is strictly broader than
   `retention:record`. Reading the scan log through it would silently widen who can see attendance
   history to every admin scope, including ones with no events remit. Querying directly keeps the
   gate exactly as narrow as the rest of §3, and avoids changing a shared helper's signature to serve
   one caller. `audit.list` and the `/portal/admin/system/audit` page are left untouched.

**Atomicity fix.** `recordScan` and `undoScan` currently `await audit.record(...)` *after*
`runAtomic(...)` (`src/db/repositories/events.ts:622`, `:655`), so a failure between the two loses
the audit row and the log silently under-reports. Both move the audit insert *into* the
`runAtomic` batch using the existing `auditInsertValues` helper, which exists for exactly this.

Columns: time, member, event, action (`Scanned` / `Undone`), status, actor.
Filters: event, scanner, member, date range. All server-side, all paginated.

Undone rows render struck-through with the reversing actor named, so a scan and its reversal read as
one story rather than an absence.

### Events list, Members list, Ledger

Events list columns: event, date, type, status, attended, late, absent, points issued. Server-side
search by title/place/type.

Members list columns: member, events attended, late count, points by type (compact), total.
Server-side search. Row click → `/portal/admin/members/[id]`.

Ledger: the existing table, moved, with server-side search and pagination replacing the client-side
`.filter()`.

### Navigation

Admin navigation lives in the portal shell sidebar and is generated from
`src/app/portal/admin/nav.ts` (`src/app/portal/admin/layout.tsx` only guards access). The new routes
register as pages inside the existing `G("data", "Events & Points", [...])` group; `crumbFor` and
`adminHeading` pick them up for free. No new nav component.

Final group order: Overview, Events, Members, Scan log, Ledger, Event Type Rules, Point Types,
Data Exports.

`nav.test.ts` is extended to cover the new pages' permission gating.

---

## §5 — Member profile (`/portal/admin/members/[id]`)

New route under `members/`, not `data/`, because it is useful beyond points.

1. **Header** — full name, email, status, roles.
2. **Retention** — points of type `pt_retention` for the selected term, against `terms.retained_at`
   and `terms.probation_below`. Reuses `RetentionProgress`.
3. **Points by type** — every type with a nonzero total.
4. **Events attended** — from `memberAttendance`: event, date, scanned at, status, points earned.
   Includes RSVP'd-but-absent rows.
5. **Ledger** — that member's records for the term, paginated.

Term selector matching the rest of the section. Gated on `retention:record`; an actor without it gets
`notFound()` before any query runs. A member's own equivalent already exists at `/portal/events`.

---

## §6 — Scanner activation and scan-system fixes

### Placement

`EventScanPanel` moves from the bottom of `src/app/portal/page.tsx` (line 143, after the library
card) to directly beneath the greeting and above the metric grid. Visual treatment in §7.

### Multiple concurrent events

`src/app/portal/page.tsx:38` uses `.find()` and silently drops any second live event where the actor
is a scanner. It becomes `.filter()`, rendering one panel per event. Rare, but the failure mode
(silently unable to scan the other event) is bad and the fix is three lines.

### Undo

`src/components/event-scan-panel.tsx:35` hardcodes `canUndo={false}`, and `undoScan`
(`src/db/repositories/events.ts:634`) requires manage rights. A scanner who mis-scans at the door has
no recovery path.

Fix, in `undoScan`: permit the delete when the target row's `crs_attendance.scanned_by =
actor.memberId`, in addition to the existing manage-rights path. `EventScanPanel` passes
`canUndo={true}`.

No time window. A scanner undoing their own scan an hour later is either correcting a real mistake or
acting maliciously, and a time limit stops neither. The control is the scan log in §4 — which now
genuinely works, because it reads the audit trail rather than the attendance table, and renders the
reversal beside the original scan. The original R1 draft claimed this control while §4 still read
`crs_attendance`, where an undone scan vanishes entirely. That gap is closed.

The scanner overlay's Undo button acts on `lastMemberId` only (`event-scan-overlay.tsx:123`), so this
widens the permission by exactly one row: the one the scanner just created.

### Shared development mode

Undo does not work through the shared dev Worker, and this is not fixed here:

- `src/server/internal/events.ts:145-150` returns 403 *"Operation is disabled in shared development."*
- `src/app/internal/events/route.ts` exports `GET`, `POST`, `OPTIONS` and **no `DELETE`**, so that
  deny-branch is unreachable dead code — Next.js returns its own 405 first.

Consequences for this spec: the `canUndo` change is a production/local capability only. `EventScanPanel`
must not promise an action the environment cannot perform, so `canUndo` is passed as
`config.APP_ENV !== "shared"`, and the overlay hides the button rather than showing one that 405s.

The dead deny-branch at `events.ts:145-150` is deleted in the same change — it documents an intent the
route file does not implement, and leaving it invites someone to trust it. Enabling shared-dev undo
properly (adding the `DELETE` export and a contract entry) is out of scope and logged under
"Known debt".

### Tests

Extend `src/db/repositories/events.integration.test.ts`: a scanner can undo a row they scanned; a
scanner cannot undo a row another member scanned; an event admin can undo either; the audit row is
written inside the same atomic batch as the delete.

---

## §7 — Interface design

Mode: **Operate**. Type: **refinement** — the incumbent visual world (Tailwind v4, shadcn-local
primitives, Unna/Source Sans, navy tokens in `src/app/globals.css`) is preserved, not replaced.

### The constraint that shapes everything

The token set has no semantic color. `--destructive` is `#121315`, near-black. Badge `success`,
`warn`, and `info` are all blues (`#4986AC`, `#90B4CC`). The brand manual commits to navy, blues, and
grays. **On-time / late / absent therefore cannot be encoded by hue.**

`src/components/event-scan-overlay.tsx:12-17` does hardcode `emerald`/`amber`/`red`. That is
defensible where it lives — a full-bleed camera surface read at arm's length in bad light, where
success/duplicate/invalid is a reflex signal, not a brand moment. Those hues stay there and do not
propagate into admin tables.

### Move 1 — Exception-first status. On time is silent.

Badging every on-time row builds a wall of badges carrying no information. Only exceptions get marks.

| Status | Treatment |
|---|---|
| On time | **No badge.** The scan time in the cell is the whole signal. |
| Late | `+12 min` chip, `Badge variant="warn"`, `tabular-nums`. The delta, not the word. |
| Absent | Row text at `muted-foreground`, scan cell shows `—`, the word `Absent` in small muted text. No badge. |

Encoding is position, weight, and a literal number rather than hue: colorblind-safe by construction,
brand-safe, denser, and `+12 min` is more actionable than `Late`.

A single `<AttendanceStatusCell>` component in `src/components/portal/` owns this rule so it cannot
drift across the six routes that render it.

### Move 2 — One question per route

Each route carries a one-line subhead naming the question it answers (the right-hand column of §4's
route table). This is the direct fix for "overwhelming": the page stops asking the reader to work out
what it is for.

### Move 3 — Density correction

Current sections use `font-heading text-2xl` — Unna, a serif display face, labelling data tables.
Operate-mode guidance forbids display fonts in UI labels and data.

- Unna stays on the page `h1` only.
- Section labels become `text-sm font-semibold uppercase tracking-[0.08em]` in Source Sans, matching
  the existing `Metric` label treatment at `events-points-dashboard.tsx:52`.
- Row padding tightens from `py-4` to `py-2.5`.

Roughly 40% more rows per screen, which is the actual job.

### Move 4 — The scanner panel is the one loud moment

Everything else stays Restrained; this single surface earns Committed color. It is a time-boxed call
to action that appears and disappears on its own, and it must not read as another card.

- Full-width accent fill (`--accent`) with `accent-foreground` text, above the metric grid.
- Primary control ≥44px touch target — this is used one-handed, standing, on a phone.
- Shows the live scanned count and the check-in window in plain words ("open until 4:30 PM"), so the
  scanner can tell at a glance whether they are early, live, or closed.
- One panel per concurrent event (§6), stacked.

### Move 5 — Numbers, not adjectives

"12 late", not "some members were late". `tabular-nums` on every count, already the house habit at
`events-points-dashboard.tsx:53`.

### Move 6 — Empty states that teach

"No one has checked in to this event" is a dead end. Each empty state names the next action:

- Event roster, no scans, **no scanner assigned** → say so, link to the event's staff panel.
- Event roster, no scans, **scanner assigned** → state that check-in opens 30 minutes before start,
  and give the time.
- Members list under a search → "No members match that search", with a clear-search control.
- Scan log, filtered to nothing → name the active filters and offer to clear them.

### States and ranges

Realistic: 20-200 events per term, 30-80 members, 0-80 attendees per event. An absent list can exceed
its attended list.

Member names are user-controlled, so every cell rendering one uses `min-w-0` + `break-all`.
`break-words` does not work here and has already caused mobile overflow in this codebase.

Every route implements: loading (skeleton rows, not a centred spinner), empty (teaching, per above),
permission-denied (`notFound()` before any query), overflow (paginated at 50).

### Boundaries

Untouched: the brand palette, the logo, Unna on page titles, the scanner overlay's camera-surface
hues, the `/portal` shell and its sidebar.

Anti-goals: traffic-light color in tables; modals for anything reachable as a route; decorative
motion; any charting library.

---

## Data flow

```
crs_attendance ──┐
crs_events ──────┼──> attendance-reports.ts ──> admin routes ──> attendanceStatus() ──> status cell
event_rsvps ─────┤        (bounded SQL)           (server)          (pure fn)
retention_records ┘
audit_logs ──────────> audit.list (filtered) ──> scan log route
```

Per-row status is never computed in SQL. SQL returns raw timestamps plus `starts_at` and
`grace_minutes`; one pure function turns them into a label. Aggregate `lateCount` is the single
deliberate exception, guarded by a test that asserts agreement with the TS function.

State and history come from different tables on purpose: `crs_attendance` for who is present now,
`audit_logs` for what happened.

## Error handling

- Repository functions throw on permission failure, matching existing convention
  (`throw new Error("Not authorized to ...")`). Routes catch and `notFound()`.
- Admin pages lacking `retention:record` call `notFound()` before any query runs.
- Pagination and filter params are parsed with `zod` and clamped, never trusted.
- `attendanceStatus` and `minutesLate` cannot throw; `null` grace falls back to the default.
- The scanner panel keeps its fail-soft behaviour — a failed scan shows a banner, never a crash.
- Undo in shared dev is hidden rather than failing at the network layer (§6).

## Testing strategy

All tests run in the Vitest Workers pool: `.ts` only, no jsdom, no render tests, no `better-sqlite3`.

**New tests**

| File | Covers |
|---|---|
| `src/lib/attendance-status.test.ts` | boundaries, null grace, early scan, `minutesLate` flooring |
| `src/db/repositories/attendance-reports.integration.test.ts` | permissions, late/absent counts, SQL-vs-TS agreement, search, limit cap, undone scan appears in the log |
| sibling of `award-editor-input.test.ts` | grace parse + range validation |

**Existing tests that break and must be rewritten.** Every one of these fails or stops typechecking
under this spec; the implementer treats a green run without touching them as a signal something was
missed.

| File | Why it breaks | Action |
|---|---|---|
| `src/db/additive-points-schema.integration.test.ts:16` | SQL fixture names the dropped column | Rewrite fixture; fails only after `0015` |
| `src/db/seed/data.test.ts:23,:25` | asserts the seeded flag | Drop the assertions |
| `src/db/repositories/pointTypes.integration.test.ts:12` | flag in fixtures + the last-retention-type guard | Rewrite; add the permanence cases (cannot retire, rename-key, or delete `pt_retention`) |
| `src/db/repositories/overview.integration.test.ts:35` | flag in fixture | Rewrite fixture |
| `src/db/repositories/retention.integration.test.ts:100,:126,:152` | calls shaped `{ kind: ... }` stop typechecking; the multi-type aggregate case becomes semantically invalid | Replace union calls with `pointTypeId`; **delete** the aggregate-counting cases; add "totals use `pt_retention` only" |
| `src/db/repositories/events.integration.test.ts:63,:70,:122` | flag in seeded point types | Rewrite fixtures |
| `src/app/portal/profile/point-breakdown.test.ts:5,:37,:47,:55` | flag-derived `retention` boolean | Rewrite against `RETENTION_POINT_TYPE_ID` |
| `src/app/portal/admin/system/point-types/input.test.ts:12` | `retentionIds` field and the last-retention-type validator | Delete those cases |
| `src/app/portal/calendar/[eventId]/award-editor-input.test.ts:9` | flag in fixture | Rewrite fixture |
| `src/app/portal/admin/nav.test.ts` | new pages | Extend for `retention:record` gating on each |

**Deliberately not changed.** `events.integration.test.ts:567` asserts a scanner cannot undo — it
remains valid and must keep passing, because the scanner there attempts to undo the *owner's* scan,
not their own. The §6 widening only covers rows where `scanned_by = actor.memberId`. Three new cases
are added beside it (scanner undoes own; scanner cannot undo another's; admin undoes either).

No existing test asserts on `audit.list`, which is why leaving it untouched (§4) costs nothing.

All proposed tests satisfy the Workers pool constraints in `vitest.config.mts:33`.

## Pre-flight

Both must clear before `0014` is applied anywhere.

1. **Audit the flag on every environment.** Any type other than `pt_retention` with the flag set
   loses its retention contribution.

   ```bash
   pnpm exec wrangler d1 execute code-nest-beta-db --config wrangler.beta.jsonc --remote --command "select id, key, label, counts_toward_retention from point_types"
   ```

   Production is a different database and config: `code-nest-prod-db` with `wrangler.jsonc`. If
   another type is flagged, decide per type: merge its records into `pt_retention`, or accept the
   drop. Record the decision before migrating.

2. **Confirm dev D1 migration state.** Local migrations run to `0013`; dev D1 was last verified at
   `0010`.

   ```bash
   pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
   ```

Per `CLAUDE.md`, the exact `pnpm exec wrangler` command is shown and approved before any D1 write.
Order: `0014` → `pnpm db:migrate:dev` → `pnpm deploy:dev` → verify → `0015`.

## Known debt (deliberate, not oversights)

- `retention_records` and `retention.ts` keep names describing one point type while holding all of
  them. Wide mechanical rename; deferred until something else forces a touch.
- The admin Events & Points section does not work in shared development mode, and this spec does not
  change that. `getDb()` throws there and the existing pages already call it directly. Fixing it
  means a contract module, internal handler, route export, adapter requests, repository wiring, and
  parity tests in `src/db/shared-parity.integration.test.ts` for five read models.
- `publicLeaderboard` has no contract operation, so the member leaderboard renders empty in shared
  dev. Pre-existing; unchanged by this spec.
- Undo remains unavailable in shared dev mode. Enabling it needs a `DELETE` export on
  `src/app/internal/events/route.ts` plus a contract entry.
- `audit_logs.detail` keeps its `member=<id>` free text alongside the new `target_member_id`.
  Removing it means rewriting every historical row for no functional gain.
- Point totals are computed per request with no caching. Correct and fast at club scale.
- `absent` covers only members who RSVP'd `going`. There is no "expected to attend" concept, so a
  mandatory-attendance report is not yet possible.

## Phasing

One spec, because late tracking feeds §3, §4, §5, and §7. Implementation phases:

1. `0014` + `schema.ts` fields + `src/lib/point-types.ts` + `attendance-status.ts` + tests
2. Audit layer: `targetMemberId` on `AuditRecordInput` and `auditInsertValues`, atomicity fix + tests
3. Retention de-specialization: repos, permanence guard, every caller in §1, the ten breaking test
   files, point-types UI, member retitle. Ends when the scoped `rg` gate returns zero.
4. `attendance-reports.ts` + tests
5. `AttendanceStatusCell` + admin routes: Overview, Events, Event roster
6. Admin routes: Members, Scan log, Ledger + nav registration
7. `/portal/admin/members/[id]`
8. Scanner panel: placement, multi-event, undo, shared-dev gating + tests
9. `0015` after a verified deploy

Phases 1-3 are independently shippable. Phases 5-7 depend on 4. Phase 8 depends only on 2. Phase 3
is the largest by file count and carries all the breakage; it is worth its own review before merge.

## Review log

### Round 1 — Codex adversarial review (partial)

The run stalled during `verifying` at 0% CPU, having emitted three findings and before completing its
own stated remainder ("caller/test/export coverage and severity ordering"). All three were
independently verified against source before being accepted; one was accepted with a correction.

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | Deploy order incompatible in both directions | Yes — `CLAUDE.md` fixes migrate-then-deploy, so a `DROP COLUMN` lands under running old code | Accepted. Split into `0014` (additive, pre-deploy) and `0015` (destructive, post-deploy). |
| 2 | `RsvpState` is `going`, not `yes` | Yes — `src/db/schema.ts:10` | Accepted. §2 absent definition corrected. |
| 3 | Undo's claimed control cannot work: the scan log reads live attendance while undo deletes that row; shared Worker denies undo and exposes no `DELETE` handler | Yes, with a correction — the deny-branch *does* exist at `src/server/internal/events.ts:145`, but `src/app/internal/events/route.ts` exports no `DELETE`, making it unreachable dead code | Accepted, expanded. Scan log re-sourced to `audit_logs` (requiring `target_member_id` + an atomicity fix); shared-dev undo gated in the UI and the dead branch deleted. *Revision 1 also made `audit.list` filterable; revision 2 withdrew that — see below.* |

Round 1 did not reach caller coverage, test coverage, exports, or the shared-dev contract surface.
Round 2 was scoped to exactly that gap.

### Round 2 — Codex bounded review (complete)

Four scopes, all covered. Five findings, all verified against source before disposition.

| # | Finding | Verified | Disposition |
|---|---|---|---|
| 1 | No `attendanceReports` in shared wiring; five new read models unreachable in shared dev | Yes — `src/db/index.ts:30` returns `createSharedRepositories()`, which also installs an unavailable audit repo | **Fact accepted, fix rejected.** `getDb()` already throws in shared mode (`client.ts:18`) and the pages this replaces already call it directly, so the section is broken there *today*. Building the contract surface repairs a pre-existing gap larger than this feature. Convention documented in §3; gap moved to Known debt. |
| 2 | `0014` adds the physical `target_member_id` but never the Drizzle field, so nothing can reference it | Yes — `schema.ts:523` has no such field | **Accepted.** §1 now requires the `schema.ts` fields and the `auditInsertValues` mapping explicitly. |
| 3 | Spec claimed the retention contract carries `PublicLeaderboardSelection`; it exposes no `publicLeaderboard` at all | Yes — `contract/retention.ts:94` has `leaderboard` only; `retention-unavailable.ts:11` stubs the rest | **Correction accepted, fix rejected.** The false claim is replaced with the real shared-mode behaviour. Adding a contract operation is the same scope expansion as #1. |
| 4 | Testing table omitted most of the tests that actually break | Yes — ten files | **Accepted.** The table is split into new tests and a breaking-test inventory with per-file actions, including deleting the now-invalid multi-type aggregate cases and preserving the still-valid undo assertion at `events.integration.test.ts:567`. |
| 5 | Caller list incomplete (notably `scripts/verify-points-upsert-local.ts`); contracts and exports listed as hits contain none; exports are xlsx not CSV; the `rg` completion gate can never reach zero because the spec itself contains the term | Yes on every point | **Accepted.** §1 now separates direct hits from manual-check surfaces and scopes the gate to `rg ... src scripts`. |

### Changes made in revision 2 beyond the review

Revision 1's filterable `audit.list` is withdrawn. `scanLog` queries `auditLogs` directly under
`retention:record`. `audit.list` gates on `hasAnyAdminScope`, which is strictly broader, so routing
the scan log through it would have widened read access to every admin scope. Querying directly is
both narrower and a smaller diff, and leaves `audit.list` and the Activity Log page untouched. The
"Activity Log gains filtering for free" benefit claimed in revision 1 was an unrequested extra and is
dropped under YAGNI.

### Design brief

`§7` folds in a confirmed Impeccable `shape` brief (Operate mode, refinement). The palette audit that
produced Move 1 is the load-bearing finding: the token set has no semantic color, so status could not
be encoded the conventional way.
