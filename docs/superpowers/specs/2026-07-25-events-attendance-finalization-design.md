# Events Attendance Finalization — Design Spec

**Date:** 2026-07-25
**Status:** Approved by product owner. Ready for planning.
**Branch:** beta
**Related:** `2026-07-04-events-attendance-system-design.md` (the member-owned model this finalizes),
`2026-07-05-events-member-owned.md` (the plan that shipped it to beta)

## Problem

Three things block finishing the member-owned events feature.

1. **Local dev is broken.** `POST /portal/calendar` returns 500 with
   `SqliteError: table crs_events has no column named deleted_at`. Migration `0009` never reached
   the local SQLite database.
2. **The scanner is a prototype.** It works, but it is an inline card with a 224px video, no torch,
   no camera flip, no member identification, no audio/haptic feedback, and no way to correct a
   mis-scan. Event checkers run it one-handed on a phone at a door.
3. **Event creation is ungated and the date inputs are raw `datetime-local`.** Any member can create
   an `official` event, and the start/end fields are two bare browser inputs that permit
   end-before-start and read nothing like booking a slot.

## Root cause of the dev failure

`drizzle/migrations/0009_events_member_owned.sql` was hand-written. It is **not** registered in
`drizzle/migrations/meta/_journal.json` (the journal stops at `0008`, and there is no
`0009_snapshot.json`).

Two migration runners read the same folder under different rules:

| Runner | Discovery | Result for `0009` |
| --- | --- | --- |
| `wrangler d1 migrations apply` (`db:migrate:dev`, `db:migrate:prod`) | Reads the **directory** | Applied |
| `drizzle-orm/better-sqlite3/migrator` (`db:migrate:local:sqlite`) | Reads the **journal** | **Skipped** |

Verified against `.local/dev.db`:

```
crs_events cols: id,title,type,status,points,place,capacity,starts_at,ends_at,
                 description,created_by,approved_by,approved_at,checkin_secret,created_at
event_staff exists: 0
__drizzle_migrations: 9 rows (0000-0008)
```

Local is missing `deleted_at`, `event_staff`, **and** `event_invites` — the entire member-owned
events migration, not just the one column in the error message. Every event-staff path in local dev
is broken, not only create.

## Second bug found during design

`recordScan` ([`src/db/repositories/events.ts:381`](../../../src/db/repositories/events.ts)) returns
`scannedAt: new Date()` on the already-present path — the time of the *duplicate scan attempt*, not
the original attendance row. It never returns `scannedBy` at all. The race-catch path at line 402
has the same defect. Any "already scanned, N minutes ago by X" UI built on today's return value
would display fabricated data.

## What already exists (reuse, don't rebuild)

- `crsAttendance` already stores both `scannedAt` and `scannedBy`. No migration needed for the
  "who and when" feature.
- `members.image` already holds the OAuth avatar URL. No migration needed for member photos.
  (`members.avatar_key` also exists but has **no render path anywhere in the UI today** — no `.tsx`
  references it. We use `image` and do not build an R2 avatar proxy for this work.)
- `canUseCameraScanner()` in `src/lib/camera-scanner-support.ts`, plus the native `BarcodeDetector`
  path with a `jsQR` fallback in `camera-scanner.tsx`, and its 2500ms same-code debounce.
- `decodeMemberCode()` / `isCheckinToken()` already distinguish a member QR from a check-in token
  from garbage — the invalid-QR detection logic exists, only its presentation is missing.
- `permissionActions` + `can()` in `src/server/auth/permissions.ts` — a working permission system to
  point the new type rules at.
- **The points guardrail is already enforced twice**: `createEventAction` passes `points: null`
  ([`src/app/portal/calendar/actions.ts:28`](../../../src/app/portal/calendar/actions.ts)) and
  `events.create` hardcodes `points: null`
  ([`src/db/repositories/events.ts:164`](../../../src/db/repositories/events.ts)). This is a
  constraint to **preserve**, not new work.

## Decisions (locked with product owner)

1. **Fix the migration split at the runner**, not by patching the journal — align the local runner
   with wrangler's directory-driven rule so hand-written SQL always applies to both.
2. **Scanner becomes a full-screen mobile takeover** on phones; desktop keeps the inline card.
3. **Undo is owner/admin only, any age.** Scanners cannot undo. Undo hard-deletes both the
   attendance row and its points row.
4. **Date entry becomes a booking-style picker**: calendar grid, start-time chips, duration chips
   that derive the end.
5. **Event-type creation rules live in an admin-editable table**, not a code constant.
6. **Only `event:points` holders set point values** — already true, preserved.
7. **Term retained/probation thresholds stay bound to Retention points only** (relevant to the
   deferred multi-type points work; recorded here so spec 3 inherits the decision).

## Non-goals

- No `ends_at NOT NULL` backfill — still deferred from the 2026-07-05 plan.
- No multi-type points system (`point_types`, `event_point_awards`,
  `retention_records.point_type_id`). That is **spec 3**, deferred by explicit product decision so
  it can be written against the `recordScan` this spec fixes.
- No changes to RSVP, event forum, or event media.
- No new npm dependency anywhere in this work.
- No admin-managed *event types* — the `casual | official | birthday` enum stays fixed; only the
  permission each type requires is configurable.

---

## 1. Migration runner — align local with wrangler

Rewrite `src/db/migrate-local-sqlite.ts` to be directory-driven, tracking applied files in a
`d1_migrations` table matching the shape wrangler creates in D1.

**Bootstrap problem.** The existing `.local/dev.db` has `__drizzle_migrations` with 9 rows and no
`d1_migrations`. A naive switch would try to re-apply `0000` and fail on `table already exists`.

**Bootstrap solution.** On first run, if `d1_migrations` is absent but `__drizzle_migrations` has
N rows, mark the first N files in sorted order as already applied, then continue. Drizzle's table
stores hash and timestamp rather than filename, but its rows are written in strict journal order, so
row count maps cleanly onto the sorted file list. The local database self-heals to `0009` with no
data loss.

```
sorted files:  0000 0001 ... 0008 | 0009 0010
drizzle rows:  9  ->  backfill 0000-0008 into d1_migrations
then apply:                        0009  ->  deleted_at, event_staff, event_invites
                                        0010  ->  event_type_rules
```

Statements split on `--> statement-breakpoint`, matching wrangler. Failures throw; no swallowing.

This does **not** change `drizzle-kit generate` — it keeps writing journal entries and snapshots for
schema-derived migrations. The journal simply stops being the authority on what has been applied. A
`ponytail:` comment in the file records that the directory is the source of truth, so migration
`0011` does not repeat this.

**Check:** a test that runs the runner twice against a temp database and asserts (a) the second run
is a no-op, and (b) `crs_events.deleted_at` and `event_type_rules` exist afterward.

## 2. `recordScan` — fix the fabricated timestamp, return display data

`RecordScanResult` grows from
`{ eventId, memberId, scannedAt, alreadyPresent }` to:

```ts
type RecordScanResult = {
  eventId: string;
  memberId: string;
  memberName: string | null;      // fullName ?? name ?? email
  memberImage: string | null;     // members.image (the OAuth avatar URL)
  scannedAt: Date;                // the ACTUAL row time, not now()
  scannedByName: string | null;   // display name of whoever scanned first
  alreadyPresent: boolean;
};
```

Both the already-present path and the race-catch path select the existing `crs_attendance` row
joined to `members` twice — once for the attendee, once for `scanned_by`. The fresh-insert path
returns the actor's own name and the row it just wrote.

`src/db/contract/events.ts` updated to match. The API route at
`src/app/api/events/[id]/scan/route.ts` passes the result through unchanged.

**Check:** extend `events.integration.test.ts` — scan twice, assert the second result carries the
**first** scan's `scannedAt` and the first scanner's name, not the second attempt's.

## 3. `undoScan` — new repository method and `DELETE` route

Authorization: event owner, event admin (`event_staff.role = 'admin'`), or `event:moderate` holders.
Plain scanners are rejected. No age limit.

```ts
runAtomic(db, [
  db.delete(crsAttendance)
    .where(and(eq(crsAttendance.eventId, id), eq(crsAttendance.memberId, memberId))),
  db.delete(retentionRecords)
    .where(and(eq(retentionRecords.eventId, id),
               eq(retentionRecords.memberId, memberId),
               eq(retentionRecords.source, "event_attendance"))),
]);
await audit.record(actor, { action: "event:undo_scan", targetType: "event", targetId: id,
                            category: "event", detail: `member=${memberId}` });
```

Both rows die together so a member cannot retain points for an event they were removed from. The
audit log is the history — no tombstone rows, no compensating negative-points entries.

Exposed as `DELETE /api/events/[id]/scan`, added to the existing route file, with the shared-env
proxy op (`op=undo_scan`) wired alongside the existing `op=scan`.

**Check:** integration tests for (a) a scanner is rejected, (b) an owner succeeds and **both** rows
are gone, (c) undoing a non-existent scan is a harmless no-op rather than an error.

## 4. Full-screen mobile scanner

`camera-scanner.tsx` is rewritten to expose the `MediaStreamTrack` controls it currently hides
(torch, camera flip) and to accept an overlay. `event-scan-panel.tsx` remains the desktop inline
card and the manual-search fallback. A new `event-scan-overlay.tsx` provides the takeover mode.

### Result states

One banner driven by five states:

```
idle       (no banner — reticle only)
success    OK   [photo]  Juan Dela Cruz - Marked present            [Undo]
duplicate  !    [photo]  Juan Dela Cruz - Already scanned
                         12 min ago by Maria Santos
invalid    X    Not a CODE member QR code
error      X    Scan failed - use search
```

`invalid` fires when `decodeMemberCode()` returns null **and** `isCheckinToken()` is false — a QR
that scanned cleanly but is not ours. `error` covers network and authorization failures.

### Feedback without asset files

WebAudio oscillator tones, no files to bundle or serve: a short high tone for `success`, a double
mid tone for `duplicate`, a low buzz for `invalid`. Paired with `navigator.vibrate` where available
(Android; iOS ignores it silently). The `AudioContext` is created lazily on the first user gesture,
since browsers block it otherwise.

### Torch

Gated on `track.getCapabilities().torch`, toggled via
`track.applyConstraints({ advanced: [{ torch: true }] })`.

**iOS Safari does not expose `torch` through `getUserMedia`.** The button will not render on iPhone
at all. This is a platform limit, not a bug to fix later — it is documented here so nobody
re-litigates it.

### Layout

`100dvh` with `env(safe-area-inset-*)` padding so the result banner clears the home indicator, and
`overscroll-behavior: none` so a downward swipe does not bounce the page behind the camera. Floating
controls sit within thumb reach at the bottom. Running scan count in the corner; the scan log lives
behind a bottom sheet so it does not compete with the viewfinder.

### Scan-loop guards

The existing 2500ms same-code debounce stays, plus a new in-flight guard so one badge held in frame
cannot fire two concurrent requests. Duplicate banners hold ~2s before returning to `idle`.

**Check:** unit tests on the pure helpers — state derivation from an API response, and the
torch-capability gate returning false when `getCapabilities` is absent.

## 5. Booking-style date picker

New `src/components/date-time-picker.tsx`: month grid for the day, then start-time chips, then
duration chips (30m / 1h / 2h / 3h / Custom) that **derive** the end.

Built with `Intl.DateTimeFormat` and plain date arithmetic — no new dependency. It emits the same
local `YYYY-MM-DDTHH:mm` strings the form already produces, which `createEventAction` parses with
`z.coerce.date()`. **Zero server change.**

Because the end is derived from a duration, end-before-start is structurally impossible. The
`endBeforeStart` state and its error paragraph in `create-event-sheet.tsx` are deleted. The
`.refine()` in `actions.ts` stays as a server-side backstop — the client can no longer produce that
input, but the action is a public entry point.

"Custom" duration reveals an explicit end date and time for multi-day events, and that path keeps a
client-side validity check.

Wired into `create-event-sheet.tsx` and the edit form in
`src/app/portal/calendar/[eventId]/event-manage-panel.tsx`.

**Check:** unit tests on the pure helpers — `deriveEnd(start, duration)` across a DST boundary and
across midnight, and `buildMonthGrid(year, month)` for leading/trailing day padding.

## 6. Admin-configurable event type gating

### Migration `0010`

```sql
CREATE TABLE event_type_rules (
  type                TEXT PRIMARY KEY,
  required_permission TEXT,
  updated_by          TEXT REFERENCES members(id) ON DELETE SET NULL,
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
INSERT INTO event_type_rules (type, required_permission) VALUES
  ('casual', NULL), ('birthday', NULL), ('official', 'event:create_restricted');
```

`required_permission` NULL means any member may create that type.

### New permission

`event:create_restricted` is added to `permissionActions` and granted to the `events` role.
(`super` passes everything via the existing short-circuit in `can()`.)

It is named generically rather than `event:create_official` **because the mapping is admin-editable**
— if an admin later restricts `birthday`, a permission named "create_official" would misdescribe
what it grants.

### Enforcement

In `events.create`, at the repository layer, alongside where `points: null` is already enforced —
so every caller inherits it, not just the one server action. `createEventAction` surfaces the
rejection as a form-level error.

The creation sheet fetches the rules and renders **only the types the actor can create**. A regular
member sees Casual and Birthday; they never see a disabled Official they cannot use.

Three rows, read per create and per form render. **No cache** — a cache over three rows is a stale
-data incident waiting to happen for no measurable gain.

### Admin screen

`/portal/admin/system/event-types` — a three-row editor, each type with a permission dropdown
sourced from `permissionActions` plus an "Any member" option. Placed under `system/` alongside
nav-pins and quick-links because it is access policy rather than content.

Writes validate the chosen value against `permissionActions` with zod, so a typo cannot silently
lock every member out of a type. Each write records an audit entry.

Guarded by **`role:assign`** — the same permission the Roles & Access screen uses
(`src/app/portal/admin/members/roles/page.tsx:12`), because this screen decides what a permission
grants. Registered in `src/app/portal/admin/nav.ts` with that permission so it appears in the admin
nav only for actors who can open it.

**Check:** integration tests for (a) a plain member creating `official` is rejected, (b) an
`events`-role actor creating `official` succeeds, (c) a plain member creating `casual` succeeds,
(d) after an admin sets `casual` to require a permission, a plain member is rejected — proving the
rule is read at runtime rather than baked in.

## 7. Deferred to spec 3 — multi-type points

Recorded so it is not lost, explicitly **out of scope** here:

- `point_types` table (Retention, Frontliner, Project Lead, ...), CRS-admin managed.
- `event_point_awards` join so one event can be worth e.g. 2 Retention + 3 Frontliner.
- `retention_records.point_type_id` FK, with every existing row backfilled to a seeded "Retention"
  type.
- `recordScan` inserting one points row per awarded type; `undoScan` deleting all of them.
- Per-type display across member profile, retention admin, and exports.
- **Locked now:** `terms.retained_at` / `terms.probation_below` continue to read Retention points
  only. Other types are tracked and displayed but carry no threshold until qualification rules are
  defined.
- **Locked now:** only `event:points` holders set point values, preserving today's two-layer
  guardrail.

## 8. Build order

1. Migration runner fix — unblocks local dev immediately, and everything below needs a working
   local database.
2. Migration `0010` + `event:create_restricted` permission.
3. `recordScan` result enrichment + timestamp fix.
4. `undoScan` repository method + `DELETE` route.
5. Event type gating enforcement + admin screen.
6. Booking-style date picker + wiring into both forms.
7. Full-screen scanner overlay.

Steps 3–4 are server-side and independent of 5–7, which are UI. Step 7 depends on 3 and 4 for the
data it displays.

## 9. Deployment

Per `CLAUDE.md`, this changes schema and permissions, so the dev Worker path must be updated:

```
pnpm db:migrate:dev
pnpm deploy:dev
```

Both require product-owner approval before running, and wrangler cannot authenticate in a
non-interactive session — the product owner runs these.

**Outstanding:** confirm whether dev D1 already has `0009` applied, via the read-only
`pnpm exec wrangler d1 migrations list DB --env dev --remote`. The attempt during design failed with
`Failed to fetch auth token: 400 Bad Request` in the non-interactive environment. Nothing in this
spec depends on the answer — `0010` applies cleanly either way — but it should be confirmed before
deploying.
