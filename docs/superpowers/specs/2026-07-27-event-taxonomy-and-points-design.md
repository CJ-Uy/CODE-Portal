# Event Taxonomy & Multi-Type Points — Design Spec

**Date:** 2026-07-27
**Status:** **Ready to plan.** Four Codex adversarial review rounds — 21 findings, all accepted and
applied. Round 4 verified every round-3 fix CLOSED and returned `IMPLEMENTATION READY: YES`. See §10
and the four review logs (`…-review-log.md`, `…-r2.md`, `…-r3.md`, `…-r4.md`).
**Branch:** beta
**Related:** `2026-07-25-events-attendance-finalization-design.md` (deferred this work as "spec 3"),
`2026-07-04-events-attendance-system-design.md` (the member-owned model)

## Problem

Two limitations remain from the finalization spec, both deferred there by explicit product decision.

1. **Event types are a fixed enum.** `casual | official | birthday` is hardcoded in ten places. An
   admin can configure *which permission* each type requires, but cannot add "Workshop" or
   "General Assembly". The org needs its own labels.
2. **Points are single-valued.** An event is worth one number, and `retention_records.points` is one
   undifferentiated column. The org needs several categories — Retention, Frontliner, Project Lead,
   and more later — with one event able to award several at once ("2 Retention and 3 Frontliner"),
   so they can drive qualification rules later.

## Two constraints that shape everything below

### A. Migration and deploy are separate steps

`db:migrate:dev` (`package.json:31`) and `deploy:dev` (`package.json:15`) are distinct commands. The
migration lands **first**; the new Worker goes live afterwards. Between them, the **currently
deployed Worker runs against the new schema**.

Therefore **every migration in this spec must be backward-compatible with the Worker already
running.** No renames of tables the live code queries, no dropped columns the live code writes, no
new `NOT NULL` column without a default that makes old inserts valid. Anything that must eventually
be removed is deprecated now and deleted in a much later release, once no deployed code touches it.

### B. No table rebuilds — they can delete data

SQLite cannot add a constraint or a foreign key to an existing column; the standard workaround is a
table rebuild (`CREATE new; INSERT SELECT; DROP old; RENAME`). Drizzle wraps those in
`PRAGMA foreign_keys=OFF; … =ON;`.

`src/db/migrate-local-sqlite.ts:11-13` records that the local runner executes each migration inside a
transaction, where `PRAGMA foreign_keys` is a **no-op**. And SQLite's `DROP TABLE` performs an
implicit `DELETE FROM` that **fires `ON DELETE CASCADE`** when foreign keys are enabled.

`crs_events` is the parent of six cascading children — event staff, invites, RSVPs, attendance,
media, and forum posts (`src/db/schema.ts:206,226,244,259,285,302`). Rebuilding it with the PRAGMA
neutered would **erase every event's attendance, staff, and forum history**.

Therefore **this spec performs no table rebuilds.** Consequences, each deliberate:

- `crs_events.type` gets **no foreign key** to `event_types`.
- `retention_records.point_type_id` gets **no foreign key** either.
- `crs_events.points` is **retained and deprecated**. Plan B2 still writes it, but only as a
  compatibility mirror of the Retention award (§5); Plan B3 removes that write once no shipped UI
  reads it. Dropping the column remains deferred indefinitely.
- The migration-runner change contemplated in an earlier draft is **not needed and not performed**.

Referential integrity for both columns is enforced in the repository layer instead, which is where
this codebase already enforces every other invariant.

## The load-bearing risk

Five places compute a member's points **total or status**, all untyped today:

| Site | What it feeds |
| --- | --- |
| `src/db/repositories/retention.ts:168` | `getMemberTermSummary` → **retained / probation status** |
| `src/db/repositories/retention.ts:200` | admin leaderboard |
| `src/db/repositories/retention.ts:219` | public leaderboard |
| `src/db/repositories/retention.ts:356` | `myHistory` — an **in-memory `reduce`**, not SQL |
| `src/db/repositories/overview.ts:51` | dashboard total |

Plus two **row projections** that are not aggregations but do need type metadata:

| Site | What it feeds |
| --- | --- |
| `src/db/repositories/retention.ts:114` | `reportBaseColumns` → the XLSX export |
| `src/db/repositories/retention.ts:339-366` | `myHistory` rows → the member's history list |

The moment a second point type writes a row, each of the five totals starts adding Frontliner points
into what is meant to be the Retention total — inflating leaderboards and **flipping members between
retained and probation**. The fourth is a JavaScript `reduce`, so a SQL-only fix silently misses it.

An exhaustive search found **no sixth total and no other retained/probation computation**; `statusFor`
is fed only by the two member-summary totals (`retention.ts:91-95,180-188,356-364`). The list is
complete.

## What already exists (reuse, don't rebuild)

- `event_type_rules` (migration `0010`) is already a type→permission map keyed by type. It gains
  columns **in place, keeping its physical name** (see §1).
- `crs_events.type` already stores the strings `casual` / `official` / `birthday` as plain
  `TEXT NOT NULL` with **no CHECK and no foreign key**
  (`drizzle/migrations/0000_young_bullseye.sql:178-200`).
- `canCreateType` / `allowedEventTypes` / `createEventTypeRulesRepository`
  (`src/db/repositories/eventTypeRules.ts`) implement permission gating including fail-closed
  handling of unrecognized permissions. Extend; do not rewrite.
- The admin screen at `/portal/admin/system/event-types` exists with its server action, pure
  `parseEventTypeRuleInput` parser, and `role:assign` guard.
- `events.create` **and** `events.update` already enforce type gating at the repository layer,
  including the same-type-resubmit rule.
- `undoScan` already deletes retention rows scoped by `(event_id, member_id, source)`, which removes
  every per-type row with no change.

## Corrections to earlier assumptions

Recorded so the plan does not repeat them:

- **`calendar-month.tsx` is NOT affected.** Its `SOURCE_CHIP` / `SOURCE_DOT` maps key off
  `CalendarItem["source"]` (`event` / `birthday` / `term_deadline`) — calendar provenance, not event
  type. Its `birthday` entry means *member birthdays* and must not be conflated with the `birthday`
  event type.
- **Event types have no colour today.** `events-list.tsx:10` carries the type union but applies no
  styling. The colour column is net-new UI.
- **There is no CSV exporter.** File export is XLSX only (`src/server/reporting/xlsx.ts:22-54`,
  `src/app/api/reporting/export/route.ts:40-58`).
- **`reportBaseColumns` is a row projection, not an aggregation.** It needs type metadata, not a
  retention filter — filtering it would hide non-Retention records from reports.

## Decisions (locked with product owner)

1. **Event types become admin-managed rows** with label, colour, required permission, active flag,
   and ordering. The `casual | official | birthday` enum is retired.
2. **Point types are admin-managed**, and a boolean `counts_toward_retention` marks which drive the
   term's retained/probation thresholds. Multiple may carry it; they sum.
3. **Soft-disable, never delete.** An `active` flag hides a type from creation forms while existing
   rows keep resolving their label and colour.
4. **Colour comes from a fixed named palette**, not free hex — the codebase styles with Tailwind
   classes, which cannot be generated at runtime.
5. **Points stay per-event.** Event types carry **no** default awards. Only `event:points` holders set
   an event's awards, preserving the guardrail that a member creating an event cannot award
   themselves points.
6. **Members see the full breakdown** — profile widget, event detail, and a type-filterable
   leaderboard defaulting to Retention — alongside admin views and exports.

## Non-goals

- No qualification *rules* engine. This spec makes the data available.
- No per-type retained/probation thresholds. `terms.retained_at` / `probation_below` keep driving a
  single total computed from the flagged types.
- No `ends_at NOT NULL` backfill — still deferred.
- No changes to RSVP, event forum, or event media.
- No new npm dependency.
- No bulk historical re-typing tool. Soft-disable means one is never required.
- **No removal of `crs_events.points` in this spec.** Deprecated only; see §B.
- **No notification outbox.** Fan-out is explicitly best-effort; see §5.

---

## 1. Event types

`event_type_rules` gains columns **in place**. Its physical table name is **unchanged** — renaming it
would break the live Worker during the deploy window (§A). Drizzle's exported symbol may be aliased
`eventTypes` in code for readability, but the SQL name stays `event_type_rules` until a much later
cleanup release.

```sql
ALTER TABLE event_type_rules ADD COLUMN label    TEXT NOT NULL DEFAULT '';
ALTER TABLE event_type_rules ADD COLUMN colour   TEXT NOT NULL DEFAULT 'slate';
ALTER TABLE event_type_rules ADD COLUMN active   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE event_type_rules ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
-- then backfill labels/colours/positions for the three seeded rows
```

All four are `NOT NULL` with a non-null default, which `ADD COLUMN` permits and which keeps the old
Worker's reads valid. A row whose `label` is still `''` renders as its `key`.

`required_permission`, `updated_by`, `updated_at` already exist and are unchanged.

### Pre-migration audit (required, blocking)

`crs_events.type` has no CHECK and no FK, so "production holds exactly the three seeded values" is an
**assumption, not a fact**. Before Plan A runs against any environment:

```sql
SELECT type, COUNT(*) FROM crs_events GROUP BY type;
```

Run it against **dev D1**, not just the local database. Any value outside the seeded three must
either abort the migration or get a reviewed, explicitly inactive placeholder row. Local currently
holds only `official`, which proves nothing about dev.

### Fail closed on an unknown type — a deliberate reversal

`canCreateType` today treats a **missing rule row as unrestricted**
(`src/db/repositories/eventTypeRules.ts:17-35`). That was correct when a missing row meant "no
permission rule configured for this valid type". Once the table **is** the type list, a missing row
means **the type does not exist**, and falling open would let any string through the repository once
the Zod enums are gone.

So this spec **reverses that behaviour for type existence**:

| Case | Behaviour |
| --- | --- |
| No row for the key | **Reject** — the type does not exist |
| Row exists, `active = 0` | Reject for new events and for type *changes*; permitted as an unchanged resubmit on an existing event |
| Row exists, `required_permission` NULL | Any member |
| Row exists, known permission | `can(actor, permission)` |
| Row exists, unrecognized permission string | Fail closed — `super` only (unchanged from spec 2) |

Zod boundaries validate key *shape* (lowercase, `[a-z0-9_]`, length ≤ 32) since they can no longer
validate membership; `events.create` / `events.update` re-validate existence, active state, and
permission at the repository layer. Keys are immutable once created — the admin UI edits label,
colour, permission, active, and position, never the key.

### Load failure is not "no types" — a required distinction

Both calendar pages currently degrade a failed rules read to an empty array
(`src/app/portal/calendar/page.tsx:30-34`, `[eventId]/page.tsx:24-33`), and `CreateEventSheet` treats
an empty allowed list as "you may create nothing" and disables submit
(`create-event-sheet.tsx:80-83,116-127`). That combination was harmless while the helper fell open.
**Once membership fails closed, a transient read failure or a shared-dev unavailable repository turns
into "no event type can be selected"** — a hard outage from a soft failure.

Plan A must therefore distinguish three states, not two:

| State | Form behaviour |
| --- | --- |
| Rules loaded, actor may create some types | Normal |
| Rules loaded, actor may create none | "You cannot create any event type" (today's empty-list message) |
| Rules **failed to load** | Distinct message; do not present an empty selector as truth |

Do not feed `[]` from a `.catch()` into a fail-closed membership helper. Repository validation remains
the enforcement point in all three states.

**Three callers need this, not two — and the third is the dangerous one.** The admin policy screen
itself catches a failed `eventTypeRules.list()` to `[]`
(`src/app/portal/admin/system/event-types/page.tsx:12-15`). Its manager then maps every type and
renders a missing rule as `""` (`event-type-rules-manager.tsx:26-28,47-53`), which the form displays
as **"Any member"**, and the action writes whatever was submitted straight back through the
repository (`event-types/actions.ts:18-23`).

So on a transient read failure — or in shared-dev, where `eventTypeRules` is a throwing Proxy
(`src/db/repositories/index.ts:98-100,117-120`) — an admin is shown every event type as unrestricted
and **can save that false default over real policy**. That is worse than the create-form outage: it is
silent privilege widening driven by a read error. The admin screen must render an explicit
unavailable state and refuse to submit, never an empty list presented as truth.

### Palette

Fixed tokens, mapped to Tailwind class pairs in one place in code:

```
primary · accent · emerald · amber · rose · slate
```

An unrecognized token falls back to `slate` rather than rendering unstyled. Falling back to a
*visual* default is safe where falling open on a *permission* would not be.

## 2. `point_types` and `event_point_awards`

```sql
CREATE TABLE point_types (
  id                       TEXT PRIMARY KEY,        -- 'pt_retention'
  key                      TEXT NOT NULL UNIQUE,    -- 'retention'
  label                    TEXT NOT NULL,
  counts_toward_retention  INTEGER NOT NULL DEFAULT 0,
  active                   INTEGER NOT NULL DEFAULT 1,
  position                 INTEGER NOT NULL DEFAULT 0,
  updated_by               TEXT REFERENCES members(id) ON DELETE SET NULL,
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE event_point_awards (
  event_id       TEXT NOT NULL REFERENCES crs_events(id) ON DELETE CASCADE,
  point_type_id  TEXT NOT NULL REFERENCES point_types(id),
  points         INTEGER NOT NULL,
  PRIMARY KEY (event_id, point_type_id)
);
```

Both are **new** tables, so foreign keys are declared at creation — no rebuild, and §B does not apply.

Seeded: `pt_retention` (Retention, `counts_toward_retention = 1`), `pt_frontliner` (Frontliner, 0),
`pt_project_lead` (Project Lead, 0).

### Authorization and the last-flag guard

Point-type policy is gated by a new `retention:configure` permission granted to the `retention` role
(CRS admins), **not** by `retention:record`. `retention:record` authorizes logging records and reading
reports (`src/server/auth/permissions.ts:52-57`, `retention.ts:230-275`); it should not also authorize
rewriting which historical points determine every member's retained status. The two actions are
separable from day one even though the same role currently holds both.

**The last-flag guard lives in the repository, not the screen.** With zero types flagged
`counts_toward_retention`, every member's retention total silently becomes zero and the whole org
drops to probation. A screen-level check is bypassable by any other caller and races when two admins
clear different types concurrently. Enforce it as a single conditional statement whose affected-row
count reports refusal:

```sql
UPDATE point_types SET counts_toward_retention = 0
 WHERE id = ?
   AND EXISTS (SELECT 1 FROM point_types
                WHERE counts_toward_retention = 1 AND active = 1 AND id <> ?);
-- 0 rows affected => refuse: "At least one active point type must count toward retention."
```

The same guard covers **deactivating** the last retention-bearing type, which needs its own
conditional statement rather than being assumed:

```sql
UPDATE point_types SET active = 0
 WHERE id = ?
   AND (counts_toward_retention = 0
        OR EXISTS (SELECT 1 FROM point_types
                    WHERE counts_toward_retention = 1 AND active = 1 AND id <> ?));
-- 0 rows affected => refuse, same message
```

### Deactivating a type that events still award

An award can be saved while its point type is active, and the type deactivated afterwards. The rule,
enforced in the repository:

**Inactive types stop granting points going forward; existing rows are preserved.** `recordScan` and
`setAwards` join `point_types` and consider **only `active = 1`** rows when creating retention rows.
Reconciliation does **not** delete rows already granted under a since-deactivated type — that history
stays, exactly as a retired event type keeps rendering on old events.

Deactivation therefore never fails because an event still awards the type. This matches the
soft-disable semantics chosen for event types in §1: retire means "stop using from now on", not
"erase the past".

Two consequences that must be implemented, not assumed:

- **Reconciliation never touches rows under an inactive type** — see §5 step 3. Otherwise saving an
  award set from an active-only editor would delete the history this rule promises to keep.
- **An awarded-but-inactive type stays visible.** An `event_point_awards` row whose type was
  deactivated afterwards still exists and grants nothing on future scans. The event-detail editor
  renders it read-only as *"Frontliner — retired, no longer grants points"*, with an explicit remove
  action. Without that, an admin sees an award that silently does nothing and has no way to
  understand why.

Active state is re-checked **inside** the set-based write (the `SELECT` joins
`point_types WHERE active = 1`), so a type deactivated between validation and write simply grants
nothing rather than producing a torn result.

## 3. `retention_records.point_type_id`

```sql
ALTER TABLE retention_records
  ADD COLUMN point_type_id TEXT NOT NULL DEFAULT 'pt_retention';
```

`NOT NULL` with a non-null default is permitted by `ADD COLUMN`; the restriction is only on a
`REFERENCES` clause alongside a non-null default. So this gets a non-null column with **no rebuild**
and **no foreign key** (§B). Existing rows take the default, which is the correct backfill.

The default is also the **expand-contract mechanism** (§A): during the deploy window the old Worker
keeps inserting rows with no `point_type_id`, and SQLite fills in Retention — exactly what that code
meant.

### Partial unique index

```sql
CREATE UNIQUE INDEX retention_records_event_member_type_idx
  ON retention_records (event_id, member_id, point_type_id)
  WHERE source = 'event_attendance';
```

Two hazards, both must be handled:

1. **Existing duplicates block creation.** `retention_records` has no uniqueness constraint today
   (`src/db/schema.ts:350-373`) and `recordEventAttendance` inserts unconditionally
   (`retention.ts:122-138`). Run a duplicate query against dev D1 **before** the migration and abort
   on any hit rather than discovering it mid-apply:

   ```sql
   SELECT event_id, member_id, point_type_id, COUNT(*) c
     FROM retention_records WHERE source = 'event_attendance'
    GROUP BY 1,2,3 HAVING c > 1;
   ```

2. **The conflict target must repeat the predicate — and the predicate must be unqualified and
   literal.** SQLite will not match a bare `ON CONFLICT (event_id, member_id, point_type_id)` against
   a *partial* index; the target must carry the same `WHERE source = 'event_attendance'`.

   The obvious Drizzle spelling **does not work**. This was verified empirically against the
   installed `drizzle-orm@0.45.2` and `better-sqlite3@12.10.0` (`package.json:52,55`):

   ```ts
   // WRONG — emits a qualified, parameterised predicate:
   //   ON CONFLICT (...) WHERE "retention_records"."source" = ?
   // better-sqlite3: "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"
   targetWhere: eq(retentionRecords.source, "event_attendance")

   // CORRECT — unqualified column, literal value, matching the index definition exactly:
   targetWhere: sql`source = 'event_attendance'`
   ```

   SQLite matches a partial index by comparing the conflict-target predicate to the index's `WHERE`
   clause, so a table-qualified column or a bound parameter defeats the match. The generated SQL is a
   **test assertion**, not a manual check — see §7.

Event-attendance rows must also carry a non-null `event_id`; assert it in the repository.

## 4. The five totals and two projections

Each of the five **totals** gains a restriction to flagged types:

```sql
SUM(retention_records.points)
  WHERE retention_records.point_type_id IN
        (SELECT id FROM point_types WHERE counts_toward_retention = 1)
```

Applied to `retention.ts:168`, `:200`, `:219`, and `overview.ts:51`.

`retention.ts:356` is **not SQL** — it is `rows.reduce((sum, row) => sum + (row.points ?? 0), 0)`.

**`myHistory` needs different treatment from the other four**, because §6 promises members a full
breakdown. Filtering its rows query to retention-bearing types would delete Frontliner history from
the member's own screen. Instead:

- return **all** the member's rows, joined to point-type metadata,
- reduce **only** rows whose joined type counts toward retention.

`recordCount` is defined as **the count of all typed rows returned**, not retention-bearing rows
only, and the test asserts that exact meaning.

The two **projections** get type metadata rather than a filter — filtering would hide records from
reports:

- `reportBaseColumns` (`retention.ts:114`) gains `pointTypeLabel`; `xlsx.ts:27`'s `Points` column is
  joined by a `Point Type` column.
- `retentionRecordOutputSchema` and `myHistory`'s row DTO (`src/db/contract/retention.ts:5-15,107-115`)
  gain the point-type label, and `src/components/retention-history.tsx:69-85` renders it — today it
  shows an unlabelled number, which becomes actively misleading once types exist.

## 5. `setPoints` → `setAwards`

```ts
setAwards(actor, eventId, awards: Array<{ pointTypeId: string; points: number }>): Promise<{ updated: number }>
```

### Validation inside the repository

`setPoints` today checks authorization but **not value validity** (`events.ts:319-333`), and the
server action passes its argument straight through (`calendar/[eventId]/actions.ts:93-98`) — the
contract's `-100..100` bound (`contract/events.ts:122-128`) is not the repository's guard, and the
form's `min`/`max` is client-side only. `setAwards` must therefore validate for itself:

- array length bounded,
- `pointTypeId` unique within the array,
- `points` an integer within `-100..100` (unchanged from the existing contract bound),
- every `pointTypeId` exists and is `active`.

Zod validation stays at the server and shared-contract boundaries too, but is not relied upon.

### Set-based reconciliation, not read-then-write

A JavaScript read of awards or attendees followed by per-row writes is race-prone: a scan can read
the old award set, a concurrent `setAwards` can commit, and the scan then writes stale rows — or an
attendee scanned mid-reconciliation is missed entirely. `runAtomic` batches **pre-built** queries
(`events.ts:139-159`), so the reconciliation must be expressed as set-based SQL evaluated *inside*
the atomic unit:

1. Replace `event_point_awards` rows for the event.
2. `INSERT … SELECT` from `crs_attendance` joined to the final `event_point_awards`, upserting on the
   partial index (with `targetWhere`, §3).
3. Delete attendance-source rows whose `point_type_id` is no longer awarded — **restricted to active
   point types** (see below).
4. Insert the audit entry **in the same atomic unit**.

**Step 3 must never delete rows belonging to an inactive type.** §2 promises that deactivating a type
preserves history, while a naive "delete everything no longer awarded" does the opposite: B3's editor
renders a row per *active* point type, so a saved award for a since-deactivated type is absent from
the submitted set, and step 3 would delete the very history §2 guarantees. The two rules contradict
unless step 3 is scoped:

```
DELETE FROM retention_records
 WHERE source = 'event_attendance' AND event_id = ?
   AND point_type_id NOT IN (<submitted award type ids>)
   AND point_type_id IN (SELECT id FROM point_types WHERE active = 1)   -- ← the restriction
```

Rows under inactive types are therefore invisible to reconciliation entirely: never created, never
deleted. Removing them requires an explicit, deliberate admin action, not a side effect of saving an
unrelated award.

### Provenance

When a newly added award creates a row for an attendance that already happened, the new row copies
`crs_attendance.scanned_by` and `crs_attendance.scanned_at` (`src/db/schema.ts:254-268`) rather than
attributing the attendance to whoever changed the awards. IDs are generated in the same statement.

`recordScan` likewise derives its rows from `event_point_awards` **inside the same batch** as the
attendance insert, not from a JavaScript snapshot read beforehand.

### Notifications are best-effort, and said so plainly

Today `setPoints` commits, then writes notifications one at a time, then writes audit
(`events.ts:327-346`); a single notification failure leaves awards changed, some attendees notified,
and **no audit entry**. Moving audit into the atomic unit (step 4) fixes the audit half. Notification
fan-out remains **explicitly best-effort**: every recipient is attempted, individual failures are
caught and logged, and no atomicity is claimed. An outbox is out of scope — this is a points update,
not a payment.

### Other retention writers

`recordScan` is **not** the only path that inserts `retention_records`. Two more exist and both break
once `point_type_id` is enforced:

- **`createManual`** (`retention.ts:230-255`) — the live admin manual-entry screen. Its input type
  (`src/db/types.ts:35-47`), server action (`admin/data/retention/actions.ts:16-29`), shared contract,
  and repository insert all gain `pointTypeId`. The admin form gains a **required** point-type
  selector defaulting to Retention — visible and changeable, never a silent default.
- **`recordEventAttendance`** (`retention.ts:122-138`) — has no production caller (only tests and the
  `retention-unavailable` stub). **Delete it and its tests** rather than carrying a second, untyped
  attendance writer that would drift from `recordScan`.

### `crs_events.points` and the `setPoints` shim

`crs_events.points` is left in place per §B, but **it cannot stop being written until no shipped UI
reads it.** The event-detail panel imports `setPointsAction`, reads `event.points` into local state,
and calls `setPointsAction(event.id, points)`
(`event-manage-panel.tsx:28-35,620-623,627-633`); the action calls `repositories.events.setPoints`
(`[eventId]/actions.ts:93-97`); the page feeds it `managed.points` (`[eventId]/page.tsx:99-113`); and
the shared contract still exposes `setPoints` (`contract/events.ts:122-128`).

So Plan B2 **keeps a compatibility shim**. It is a **distinct operation, not an alias for
`setAwards`** — this distinction is load-bearing:

`setAwards` has **whole-set replacement** semantics. A shim implemented as
`setAwards([{ pt_retention, points }])` would therefore **erase every non-Retention award on the
event**, which is exactly the case B2 creates: `setAwards` exists while the old single-number panel is
still live. An admin awards 2 Retention + 3 Frontliner, someone touches the old panel, and the
Frontliner award silently vanishes.

`setPoints(actor, eventId, points)` must instead be a **scoped, Retention-only** operation:

- Update, insert, or remove **only** the Retention award row.
- Leave every other `event_point_awards` row untouched.
- Reconcile only the Retention attendance rows affected by that change.
- Mirror the Retention value into `crs_events.points`.
- Return **the distinct attendee count**, not an affected-row count.

That return value matters: today `setPoints` returns `attendees.length` (`events.ts:323-326,345-346`)
and the panel renders it as `Updated {result} attendee record(s).`
(`event-manage-panel.tsx:668-670`). A multi-type affected-row count would make that sentence a lie.

`setAwards` mirrors its Retention award into `crs_events.points` for the same reason, so the old panel
keeps showing a truthful number while it still exists.

Plan B3 replaces the panel with the per-type editor, and only **then** are the shim and the mirror
removed. Column removal itself stays deferred (§B).

## 6. UI

**Admin — `/portal/admin/system/event-types`** (extend the existing screen): label, colour token,
required permission, active toggle, ordering, plus creating new types. Keeps its `role:assign` guard
and its pure-parser + server-action structure. Key is set at creation and immutable thereafter.

**Admin — point types** (new sibling screen, same pattern): label, `counts_toward_retention`, active,
ordering. Guarded by `retention:configure` (§2), enforced again in every repository mutator.

**Admin — manual retention entry:** gains a required point-type selector defaulting to Retention.

**Event detail:** shows "Worth: 2 Retention · 3 Frontliner". `event:points` holders get an editor with
a row per active point type.

**Create/edit event forms:** the type `<select>` renders active types the actor may create, plus the
event's current type even if inactive or otherwise disallowed.

**Events list:** type badge coloured from the type's palette token — net-new styling.

**Profile:** a row per active type. Retention keeps retained/probation styling; others render as
plain counts.

**Member history (`retention-history.tsx`):** each row gains its point-type label.

**Leaderboard:** a type selector defaulting to Retention, so current behaviour is unchanged when
untouched.

## 7. Testing

Constraints from `vitest.config.mts` are binding and unchanged: Workers pool, `.ts` only, no jsdom,
no React Testing Library, no component render tests, `better-sqlite3` importable by no test.

Required coverage:

- **The five totals.** With one member holding both Retention and Frontliner rows in a term, assert
  `getMemberTermSummary`, both leaderboards, `myHistory`'s total, and the overview total each report
  **only** the retention-flagged points. This is the test that would have caught the whole risk.
- **`myHistory` returns all rows** including non-retention ones, with labels, while its total counts
  only flagged types — and `recordCount` means all typed rows.
- **Threshold integrity.** A member exactly at `retained_at` in Retention who also holds Frontliner
  points must not change status.
- **`setAwards` validation.** Duplicate `pointTypeId`, non-integer points, out-of-range points, and
  unknown or inactive type IDs are each rejected by the repository, not just the form.
- **`setAwards` reconciliation.** Adding, changing, and removing an award updates attendees' rows
  correctly; an unchanged award preserves `recorded_at`; a newly added award copies
  `scanned_by`/`scanned_at` from the attendance row.
- **Upsert targeting.** Assert the **generated SQL string** contains an unqualified, literal
  `WHERE source = 'event_attendance'` (not `"retention_records"."source" = ?`), and that the
  statement actually upserts against the partial index on both D1 and better-sqlite3. A qualified or
  parameterised predicate silently fails to match the index and throws at runtime — see §3.
- **Inactive point types.** A scan against an event awarding a since-deactivated type creates no row
  for it, while rows already granted under that type survive reconciliation untouched.
- **Rules load failure.** A failed `eventTypeRules.list()` renders the distinct unavailable state,
  not an empty "you may create nothing" selector.
- **`setPoints` shim scope.** Calling the shim on an event awarding 2 Retention + 3 Frontliner
  changes only Retention and **leaves the Frontliner award intact**, and returns the distinct
  attendee count so the old panel's "Updated N attendee record(s)" stays true.
- **Inactive-type history survives reconciliation.** Saving an active-only award set on an event that
  also holds an award for a deactivated type leaves that type's existing retention rows untouched.
- **Admin policy screen fails visibly.** A failed `eventTypeRules.list()` renders the unavailable
  state and refuses submission, rather than showing every type as "Any member" — which would let an
  admin overwrite real policy from a read error.
- **Unknown event type fails closed.** A `crs_events.type` value with no matching row is rejected on
  create and on type change.
- **Soft-disable.** An inactive type cannot be chosen for a new event or switched to, but an event
  already on it can have another field edited.
- **Last retention flag.** Both clearing the flag and deactivating the last flagged type are refused
  at the repository, with the refusal driven by affected-row count.
- **Manual entry** requires a point type and records it.
- **XLSX export** carries the point-type column.

## 8. Deployment discipline

Every stage below is **migrate → verify → deploy**, and each migration must be safe for the Worker
already running (§A). Per `CLAUDE.md`, both commands need product-owner approval and wrangler cannot
authenticate non-interactively, so the product owner runs them:

```
pnpm db:migrate:dev
pnpm deploy:dev
```

**Outstanding from the previous spec:** migration `0010` has not yet been applied to dev D1. It must
land before anything here, since `event_type_rules` is the table these migrations alter.

## 9. Plans

One spec, four plans. Each is independently deployable and rollback-compatible.

**Plan A — event types as data.** Columns on `event_type_rules` (in place, name unchanged), palette,
pre-migration distinct-type audit, fail-closed type resolution, the ten hardcoded `z.enum` / union
sites, active-flag handling, admin screen, type badges, and the **three-state load handling across all
three callers** — both calendar pages *and* the event-types admin screen (§1). No points involvement,
no rebuilds.

**Plan B1 — additive points schema.** `point_types`, `event_point_awards`,
`retention_records.point_type_id` with its default, the duplicate pre-check and partial unique index,
plus migration verification on a fresh and an existing database. No behaviour change yet.

**Plan B2 — repository and contracts.** `setAwards` with validation and set-based reconciliation,
`recordScan` deriving rows from active awards, `createManual` gaining `pointTypeId`, deleting
`recordEventAttendance`, the five totals, the two projections **including the XLSX point-type
column**, and the full aggregation test matrix. Ships the `setPoints` compatibility shim and the
`crs_events.points` mirror described in §5 — without them B2 is not independently deployable, because
the event-detail panel still calls `setPointsAction` and reads `event.points`.

**Plan B3 — UI and cleanup.** Point-types admin screen, event-detail per-type award editor, profile
breakdown, member history labels, leaderboard type selector. Removes the B2 shim and the
`crs_events.points` mirror once the panel no longer reads them. Dropping the column itself stays
deferred (§B).

Plan A first for product value; the technical dependency between A and B is weak (the retention
repository does not call the event-type repository — `retention.ts:1-9`), so B1 could proceed in
parallel if desired.

## 10. Review history

Round 1 — Codex adversarial review, 12 findings (2 Critical, 8 Important, 2 Minor), **all accepted**.
Full text: `2026-07-27-event-taxonomy-and-points-review-log.md`. Summary of what changed:

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | Migrations incompatible with the deployed Worker | §A expand-contract; table name kept, column defaulted, nothing dropped |
| 2 | PRAGMA fix unsound; `crs_events` rebuild can cascade-delete children | §B no rebuilds at all; runner change removed; `points` deprecated not dropped |
| 3 | `createManual` and `recordEventAttendance` missed | §5 both handled; the unused one is deleted |
| 4 | `setAwards` read-then-write race, provenance undefined | §5 set-based reconciliation inside the atomic unit; provenance copied from attendance |
| 5 | Partial index needs `targetWhere`; existing duplicates block creation | §3 duplicate pre-check and explicit `targetWhere` |
| 6 | `retention:record` too broad; last-flag guard bypassable and racy | §2 new `retention:configure`; guard moved into a conditional SQL update |
| 7 | Missing type row falls open; "no rows migrated" unverified | §1 deliberate reversal to fail closed; blocking pre-migration audit |
| 8 | `setAwards` has no value validation | §5 explicit repository-level validation |
| 9 | `myHistory` filter contradicts the member breakdown promise | §4 return all rows with labels, reduce only flagged types |
| 10 | Notification/audit partial failure | §5 audit into the atomic unit; fan-out declared best-effort |
| 11 | "Six aggregations" inaccurate; no CSV exporter | §4 renamed to five totals + two projections; XLSX only |
| 12 | Plan B too broad; A→B dependency weaker than claimed | §9 split into B1/B2/B3; dependency restated as weak |

Round 2 — Codex adversarial review of the revised spec, 5 findings (3 Important, 2 Minor), **all
accepted**. Full text: `2026-07-27-event-taxonomy-and-points-review-log-r2.md`.

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | `targetWhere: eq(...)` emits a qualified, parameterised predicate that SQLite will not match to a partial index — verified empirically against the installed drizzle/better-sqlite3 | §3 requires unqualified literal ``sql`source = 'event_attendance'` ``; the generated SQL is now a test assertion |
| 2 | B2 not independently deployable — the event-detail panel still calls `setPointsAction` and reads `event.points` | §5 adds a `setPoints` shim mapping to the Retention award plus a `crs_events.points` mirror; §9 states both explicitly, removed in B3 |
| 3 | A point type deactivated after an award was saved left the rule undefined; deactivate guard lacked its `active = 0` statement | §2 states the rule (inactive types stop granting, history preserved) and adds the second conditional statement |
| 4 | `.catch(() => [])` feeding a fail-closed helper turns a transient read failure into "no type selectable" | §1 requires three distinct states, separating load failure from an empty allowed list |
| 5 | B2/B3 boundary muddy — projections typed in B2 but the export column deferred to B3 | §9 moves the XLSX point-type column into B2 alongside the projection work |

Round 2 also **verified as correct**: expand-contract holds for the deployed Worker at the Plan A and
B1 gaps; `ADD COLUMN … NOT NULL DEFAULT 'pt_retention'` is legal on SQLite and accepted by
better-sqlite3 inside the runner's transaction; deleting `recordEventAttendance` is safe (no
production caller, including shared-dev); and Plans A, B1 and B3 each stop safely on their own.

Round 3 — Codex adversarial review scoped to the round-2 changes, 4 findings (3 Major, 1 Minor),
**all accepted**. Verdict was `IMPLEMENTATION READY: NO`. Full text:
`2026-07-27-event-taxonomy-and-points-review-log-r3.md`.

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | A `setPoints` shim implemented as a `setAwards` alias would **erase every non-Retention award**, since `setAwards` replaces the whole set; `{ updated }` was also underspecified against the panel's "attendee record(s)" copy | §5 redefines the shim as a scoped Retention-only operation that preserves other awards and returns the distinct attendee count |
| 2 | §2's "preserve history" and §5's "delete no-longer-awarded" **directly contradict** once B3's active-only editor omits a deactivated type's award | §5 step 3 restricted to active types; §2 adds the read-only "retired, no longer grants" affordance and the in-write active re-check |
| 3 | The three-state load missed a **third caller — the admin policy screen itself**, where a read failure renders every type as "Any member" and an admin can save that over real policy | §1 covers all three callers; the admin screen renders an unavailable state and refuses submission |
| 4 | §B still said `crs_events.points` is "left unwritten", contradicting B2's compatibility mirror | §B rewritten: retained, mirrored in B2, mirror removed in B3, column drop deferred |

Round 3 also **verified as correct**: the §3 upsert recipe works in §5's actual
`insert().select().onConflictDoUpdate()` shape against the partial index, inside `runAtomic`'s
synchronous local `.run()` pattern (probed against the installed packages); and §2's second
deactivation guard is correct for the non-retention-bearing case and serialises correctly under
concurrent deactivation.

Round 4 — verification pass. All four round-3 findings verified **CLOSED** with spec line references,
no new findings, verdict **`IMPLEMENTATION READY: YES`**. Full text:
`2026-07-27-event-taxonomy-and-points-review-log-r4.md`.

**Totals across four rounds: 21 findings raised, 21 accepted, 21 applied.** Two would have caused data
loss (rebuilding `crs_events` cascade-deleting six child tables; a `setPoints` shim erasing
non-Retention awards), one would have widened privileges from a transient read error, and one would
have failed at runtime on the first reconciliation.
