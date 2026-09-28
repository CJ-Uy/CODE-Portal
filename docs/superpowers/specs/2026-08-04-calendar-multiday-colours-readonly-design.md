# Calendar: multi-day spans, type colours, read-only events — design

Date: 2026-08-04
Status: draft — pending adversarial review
Branch: `beta`

## Problem

Three gaps in the calendar surface:

1. **Multi-day events collapse to one cell.** `crs_events.ends_at` already exists and may land on a later
   day, but `calendar.getMonth` emits a single `CalendarItem` keyed to `toIsoDate(startsAt)`, and
   `CalendarMonth` buckets strictly by that one date. A 3-day event renders as a single chip on day 1.
   The month query compounds it: `where startsAt >= start and startsAt < end` means an event that
   started last month and runs into this one is **invisible** in this month entirely.
   There is also no way to *enter* a multi-day span: `DateTimePicker` picks one day plus a duration
   chip (30m/1h/2h/3h/custom).

2. **Type colours exist but do not reach the calendar or the create form.** `event_type_rules.colour`
   is persisted, `colourClasses()` maps tokens to Tailwind pairs, and `events-list`, `event-manage-panel`
   and the admin manager all honour it. `calendar-month.tsx` ignores it and hardcodes a chip/dot by
   `CalendarItem["source"]`, so every event is `primary` regardless of type. The create sheet shows type
   as a bare `<select>` with no colour signal, so the author cannot see what they are choosing.

3. **No informational events.** Every event carries RSVP, signup form, capacity, grace period, QR
   check-in, attendance and points. There is no way to put "Finals week" or "Campus closed" on the
   calendar without also exposing signup and scanning affordances that make no sense for it.

## Decisions (locked with the user 2026-08-04)

- **Read-only means no member interaction**, not restricted editing. A read-only event appears on the
  calendar and its detail page; it has no RSVP, no signup form, no check-in, no attendance, no points.
  Organizers and `event:moderate` holders can still edit it.
- **Multi-day entry is an all-day toggle plus an end date.** Toggle off keeps today's single-day +
  duration-chip flow byte-for-byte. Toggle on hides times and picks start date + end date.
- **`event:moderate` gates read-only.** No new permission action, no per-type rule column.
- **Read-only is togglable on an existing event** by `event:moderate` holders, so a mistake is
  repairable. Event admins already hold CRUD over every event; this rides that capability.

## Non-goals

- Week and day calendar views. Month grid only.
- Recurring events.
- Timezone work. Everything stays UTC+8, as `date-slots` already assumes.
- Changing who may create which *type* — `canCreateType` is untouched.

## Schema

Migration `0019_event_multiday_and_readonly.sql`, additive only:

```sql
ALTER TABLE crs_events ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crs_events ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;
CREATE INDEX crs_events_ends_at_idx ON crs_events (ends_at);
```

Drizzle (`src/db/schema.ts`, `crsEvents`):

```ts
allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
readOnly: integer("read_only", { mode: "boolean" }).notNull().default(false),
```

`all_day` is stored rather than derived. Derivation from `endsAt` spanning a day boundary cannot tell
"Aug 12 09:00 → Aug 14 17:00" (a timed event running three days) from "Aug 12–14, all day", and the
edit form must round-trip the author's choice.

The `ends_at` index exists because the month query stops being a pure `starts_at` range scan (below).

### `ends_at` becomes semantically required for all-day events

`ends_at` stays nullable in the column definition — existing rows have nulls and the migration will not
backfill them. Invariant enforced in the repository, not the DB: **when `allDay` is true, `endsAt` is
non-null.** All-day writes normalize to `startsAt` = 00:00:00.000 UTC+8 on the start date and `endsAt` =
23:59:59.999 UTC+8 on the end date. Read paths still treat a null `endsAt` as "ends the day it starts".

## Multi-day rendering

### Month query must select by overlap, not by start

`calendar.getMonth` currently drops any event whose `startsAt` falls outside the month. Replace with an
overlap predicate so an event spanning the boundary appears in both months.

`monthRange()` returns a **half-open** `[monthStart, monthEnd)` at UTC+8 midnight
(`src/lib/calendar.ts:14-16`), so the end comparison must be strict — an event ending exactly at
`monthStart` has zero overlap with the month:

```
startsAt < monthEnd
AND (endsAt IS NULL ? startsAt >= monthStart : endsAt > monthStart)
```

A null `endsAt` is a point-in-time event, so it uses `>=`: an event starting exactly at `monthStart` is
in the month. A non-null `endsAt` uses `>` for the half-open reason above. Collapsing both into
`coalesce(endsAt, startsAt) >= monthStart` is wrong — it pulls in an event that ended the instant the
month began (review finding D1).

Both months then render their own slice of the same event, clipped to the visible grid.

### Deriving the inclusive `endDate` — the midnight trap

`toIsoDate` (`src/lib/calendar.ts:20-21`) maps an instant to its UTC+8 calendar day. An event ending at
exactly `Aug 15 00:00:00.000+08` maps to `2026-08-15`, but it occupies **none** of Aug 15 — rendering a
bar through that day makes every midnight-ending event one day too long (review finding D2).

`endDate` is therefore derived from the last instant the event actually occupies:

```ts
const endDate = endsAt
  ? maxIso(date, toIsoDate(new Date(endsAt.getTime() - 1)))
  : date;
```

The `maxIso` floor guards a zero-length event starting exactly at midnight, where subtracting 1 ms would
otherwise walk back into the previous day. All-day events stored at `23:59:59.999` are unaffected: minus
1 ms is still the same calendar day.

### `CalendarItem` gains three fields

```ts
export type CalendarItem = {
  // ...existing
  endDate: string;      // inclusive ISO day; equals `date` for single-day items
  colour: string;       // event-type colour token; birthdays and term deadlines keep their source default
  readOnly: boolean;    // events only; false for other sources
};
```

`getMonth` joins `event_type_rules` on `crs_events.type` to resolve `colour`. A missing or retired rule
degrades to `slate` via the existing `colourClasses()` fallback — no throw, since a vanished type row
must not blank the calendar.

Birthdays keep `accent`, term deadlines keep `destructive`, both with `endDate === date`. All three
literal construction sites must set the new fields: `calendar.ts:61` (event), `:81` (birthday), `:98`
(term deadline).

**The shared-Worker contract must be updated in the same change** (review finding D5).
`calendarItemSchema` in `src/db/contract/calendar.ts:6` is a zod object that
`src/server/internal/calendar.ts:51` runs `.parse()` over before returning the month payload. `z.object`
**strips** unknown keys rather than rejecting them, so adding `endDate`, `colour` and `readOnly` to the
type without adding them to the schema does not fail loudly — it silently drops them on the shared dev
Worker path only. Colours and multi-day spans would work locally and quietly break in `APP_ENV=shared`.
Both files ship with the type change.

### Layout: bars live in the week row, not the day cell

The current grid is one flat `grid-cols-7` of independent day cells; a chip cannot escape its cell.
Restructure `CalendarMonth` to render **one row per week**. Each week row is a `grid grid-cols-7` for
the day-number header, followed by a bar layer that is also `grid grid-cols-7`. A bar sets
`gridColumnStart` / `gridColumnEnd` from its clipped span, so a 3-day event is one element crossing
three columns. No absolute positioning, no measured widths.

An event crossing a week boundary is **split into one bar per week row**, each clipped to that row.
Continuation is signalled visually: a bar clipped on its left loses its left rounding and gains a
left-pointing chevron; same mirrored on the right.

### Lane packing is a pure, tested function

New `src/lib/calendar-layout.ts`:

```ts
export type LaidOutBar = {
  item: CalendarItem;
  weekIndex: number;
  startCol: number;      // 1-7, inclusive
  endCol: number;        // 1-7, inclusive
  lane: number;          // 0-based row within the week
  continuesLeft: boolean;
  continuesRight: boolean;
};

export function layoutMonthBars(
  items: CalendarItem[],
  weeks: Array<Array<string | null>>,   // ISO day per cell, null for padding
  maxLanes: number,
): { bars: LaidOutBar[]; overflowByDay: Map<string, number> };
```

Greedy first-fit lane assignment: sort by start day ascending, then by span length descending (longest
bars claim the top lanes so they read as the spine of the week), then by title for a stable tie-break.
Each bar takes the lowest lane free across every column it covers.

Bars that would land in lane >= `maxLanes` (3) are dropped from `bars` and instead increment
`overflowByDay` for **each day they cover**, so the existing "+N more" affordance stays truthful per
day. This function is where the real complexity lives, and it is pure — it gets the unit tests. Per the
Workers-pool constraint, tests are `.ts` only with no rendering.

### Week start: the grid stays Sunday-first

The codebase currently disagrees with itself (review finding D3): `buildMonthGrid`
(`src/lib/date-slots.ts:27-29,35`) is **Monday-first with a 0-indexed month** and is what the
create-event date picker uses (`date-time-picker.tsx:31,34,43`), while the month calendar
(`calendar-month.tsx:6,20,36`) is **Sunday-first with a 1-indexed month**.

The bar layout uses the month calendar's own Sunday-first cell array. `buildMonthGrid` is **not** reused
here, despite the apparent overlap — adopting it would silently shift the calendar's week start and
change a screen nobody asked to change. Unifying the two is a separate cleanup, deliberately out of
scope.

### Padding cells

Leading/trailing padding days in the first and last week are `null` in the grid. A bar never extends
into a padding cell; it clips at the month edge and sets the matching `continues*` flag.

## Type colours

- `CalendarMonth` drops `SOURCE_CHIP` / `SOURCE_DOT` and calls `colourClasses(item.colour)`.
- **Create sheet** replaces the bare `<select>` with a colour-aware control: each option shows the
  type's dot, and directly below the field a live preview chip renders exactly as it will appear on the
  calendar (`colourClasses(selectedType.colour).chip` + dot + the typed title, falling back to the type
  label while the title is empty). Native `<option>` cannot be styled reliably across browsers, so the
  control becomes a small button row of type chips when `allowedTypes.length <= 6`, and keeps the
  `<select>` plus a preview swatch above that count. `allowedTypes` already carries `colour` — no new
  server data.
- No new palette. The six existing tokens stand.

## Read-only events

### Write path

`CreateEventInput` and `UpdateEventInput` gain `allDay: boolean` and `readOnly: boolean`.

`events.create` and `events.update` enforce, **in the repository** so the server action is not the only
gate:

1. `readOnly === true` requires `can(actor, "event:moderate")`, else throw. Applies on create and on
   any update that flips the flag in either direction.
2. When `readOnly` is true, coerce interaction fields on write: `capacity = null`, `graceMinutes = null`,
   `rsvpForm = []`, `rsvpResponsesPublic = false`, `points = null`. Coerce rather than reject, so the
   toggle is a single action and cannot leave a half-configured row.
3. When `allDay` is true, normalize `startsAt`/`endsAt` to the day boundaries described above and
   require `endsAt >= startsAt` on the **date**, not the instant — a one-day all-day event is valid and
   has `endDate === date`.

The existing `endsAt > startsAt` refinement in `createSchema` must become conditional: it stays as-is
for timed events, and becomes a date-level `>=` comparison for all-day ones. A same-day all-day event
would otherwise fail validation.

### Mutation blocking — the security boundary

Every member-interaction mutation must fail closed when the target event is read-only. Enumerated
against the current `EventsRepository` surface:

| Method | Read-only behaviour |
|---|---|
| `setRsvp` | throw — "This event does not take signups." |
| `recordScan` | throw — "This event does not take check-ins." |
| `undoScan` | throw (same message; nothing to undo, and it must not appear to succeed) |
| `setAwards` | throw — "This event does not award points." |
| `removeRetiredAward` | throw — see review finding R2 below |
| `invite` | throw — an invite implies a signup that cannot happen |
| `searchAttendableMembers` | return `[]` — a read path feeding a blocked write |
| `listAttendance`, `listSignupResponses`, `listAwards`, `listInvites` | allowed — historical rows stay visible to organizers |
| `addStaff`, `removeStaff`, `transferOwnership`, `softDelete`, `update` | allowed — organizer administration is unaffected |

Checks live next to each method's existing capability check, not in a shared wrapper, so a future method
added without a read-only check is visible in review rather than silently inheriting one.

**`EventsRepository` is not the whole surface.** Two further repositories mutate an event's member-facing
content and must block read-only events the same way:

| Repository / method | Route | Read-only behaviour |
|---|---|---|
| `eventMedia.add` | `POST /api/events/[id]/media` | throw — no uploads to an informational event |
| `eventForum.post` | `POST /api/events/[id]/forum` | throw — no discussion thread |
| `eventMedia.listForEvent`, `eventForum.listForEvent` | `GET` | allowed — pre-existing content stays readable |

Verified that the HTTP routes are a genuinely separate entry point from the server actions
(`src/app/api/events/[id]/{rsvp,scan,media,forum,members,attendance}/route.ts`), which is precisely why
enforcement belongs in the repositories: both entry points funnel through them, and gating only the
server actions would leave every one of these routes open.

### Flipping an existing event to read-only

Rows already collected are **preserved, never deleted**. Attendance, RSVPs, signup answers and awards
stay in the database and stay visible to organizers on the manage panel under a notice that the event
was made informational. Members stop seeing signup and check-in affordances immediately. Points already
credited are out of scope to claw back — reversing awards is an existing admin flow, not this feature's
job. The manage panel warns before the toggle when `attendingCount > 0` or awards exist, naming what
will be hidden from members.

### Read path and UI

`EventDetail` and `EventRecord` gain `allDay` and `readOnly`.

Event detail page (`/portal/calendar/[eventId]`), when `readOnly`:

- Hide `EventSignupPanel` entirely.
- Hide QR check-in, scanner entry and the attendance-taking UI.
- Show a neutral notice: "Informational event — no signup or check-in."
- Keep title, type chip, place, description, dates, media.
- Manage panel keeps edit, staff and delete; hides awards editing; shows preserved historical rows if any.

Calendar and list chips render read-only events with the type colour, plus a small `Info` icon in place
of interaction affordances. Read-only is not itself a colour — colour stays owned by type.

### Date display

- Timed single-day: unchanged.
- Timed multi-day: "Aug 12, 9:00 AM → Aug 14, 5:00 PM".
- All-day single: "Aug 12 · All day".
- All-day multi: "Aug 12 – 14 · All day".

## Files touched

| File | Change |
|---|---|
| `drizzle/migrations/0019_event_multiday_and_readonly.sql` | new — two columns, one index |
| `src/db/schema.ts` | `allDay`, `readOnly` on `crsEvents` |
| `src/lib/calendar.ts` | `CalendarItem` gains `endDate`, `colour`, `readOnly` |
| `src/lib/calendar-layout.ts` | new — `layoutMonthBars`, pure |
| `src/lib/calendar-layout.test.ts` | new — lane packing, week splits, clipping, overflow |
| `src/db/repositories/calendar.ts` | overlap query, type-rule join, new item fields, `EventDetail` fields |
| `src/db/contract/calendar.ts` | `calendarItemSchema` gains `endDate`, `colour`, `readOnly` (finding D5) |
| `src/server/internal/calendar.ts` | shared-Worker month payload carries the new fields |
| `src/lib/event-code.ts` + test | short share codes — **done**, 5/5 passing |
| `src/lib/calendar-export.ts` + test | Google Calendar URL + ICS, exclusive-end handling |
| `src/app/events/[code]/route.ts` | share-link resolver |
| `src/app/events/[code]/event.ics/route.ts` | ICS download |
| `src/db/repositories/events.ts` | create/update gating + coercion, read-only blocks on the table above |
| `src/components/calendar-month.tsx` | week-row restructure, bar layer, `colourClasses` |
| `src/app/portal/calendar/actions.ts` | schema fields, conditional end-after-start refinement |
| `src/app/portal/calendar/create-event-sheet.tsx` | all-day toggle, end date, colour-aware type control, preview chip |
| `src/components/date-time-picker.tsx` | all-day mode: date range, times hidden |
| `src/app/portal/calendar/[eventId]/page.tsx` | hide interaction when read-only, notice, date formatting |
| `src/app/portal/calendar/[eventId]/event-manage-panel.tsx` | read-only toggle (`event:moderate`), warning, preserved-rows notice |
| `src/app/portal/calendar/events-list.tsx` | multi-day date range, read-only marker |
| `src/lib/date-slots.ts` | all-day boundary helpers, multi-day range formatting |

## Test plan

Pure-function unit tests (Workers pool, `.ts` only, no rendering):

- `calendar-layout`: single-day bar; bar spanning a week boundary splits into two with correct
  `continues*`; three overlapping bars take lanes 0/1/2; a fourth overflows and increments
  `overflowByDay` for every covered day; a bar clipped at month start/end; padding cells never covered.
- `date-slots`: all-day boundary normalization; multi-day range formatting in all four display cases.
- Repository integration: overlap query returns an event started in the prior month; read-only event
  rejects `setRsvp` / `recordScan` / `setAwards` / `invite`; non-moderator cannot set `readOnly` on
  create or update; flipping read-only coerces capacity/grace/form/points; existing attendance rows
  survive the flip.

## Deployment

Per project rules, after the schema change: `pnpm db:migrate:dev` then `pnpm deploy:dev`, each shown as
an exact `pnpm exec wrangler` command and approved before running. Migration 0019 is additive with
defaults, so it is backward compatible with the currently deployed Worker.

## Part 4 — Human-readable audit log

### Problem

`/portal/admin/system/audit` renders each entry as three raw fields: a category badge, the literal
action key (`event:set_awards`), and `targetType:targetId.slice(0,16)` (`event:evt_a1b2c3d4e5f6g7`).
`audit.list` selects from `audit_logs` alone, so **the actor is never shown at all** — `actorMemberId`
is stored but never joined or rendered. `detail` is stored and never rendered. The result is
technically a log and practically unreadable.

### Shape

`audit.list` returns a resolved view rather than the bare row:

```ts
export type AuditEntryView = AuditEntry & {
  actorName: string | null;        // members.fullName ?? members.name
  targetMemberName: string | null;
  targetLabel: string | null;      // resolved human name of targetId, by targetType
};
```

Resolution is **batched, never per-row**: collect distinct `actorMemberId` + `targetMemberId` into one
`members` query, then one query per distinct `targetType` present in the page (`crs_events.title`,
`short_links.slug`, `announcements.title`, `library_items.title`, `point_types.label`, `surveys.title`,
`nav_pins.label`, `quick_links.label`, `event_type_rules.label`, `members.name`). At a 100-row limit
that is at most a handful of queries. Target types with no natural name column (`database`,
`term_member_roster`, `member_role`, `forum_post`, `library_comment`) resolve to `null` and fall back to
a shortened id.

### Actor attribution must not lie

Three cases, and the shared-token one is a correctness requirement, not cosmetics:

- `actorContext === "session"` with a resolvable member → the member's name.
- `actorContext === "shared_dev_token"` → **"Shared token · {sharedTokenLabel}"**, never a person's
  name, even though `actorMemberId` is populated. Attributing an automated shared-token write to a human
  would make the log actively misleading in exactly the situation it exists to clarify.
- `actorMemberId` null (member deleted, `on delete set null`) → "Deleted member".

### Phrasing

New pure module `src/lib/audit-phrasing.ts`:

```ts
export type AuditPhrase = { verb: string; preposition: string | null };
export function phraseFor(action: string): AuditPhrase;
export function describeAudit(entry: AuditEntryView): { actor: string; sentence: string };
```

A lookup table covers all 39 current action keys, e.g.:

| Action | Renders as |
|---|---|
| `event:create` | Ana Reyes **created event** Study Jam |
| `event:set_awards` | Ana Reyes **set points on** Study Jam |
| `event:scan_attendance` | Ana Reyes **checked in** Miguel Cruz **at** Study Jam |
| `role:assign` | Ana Reyes **assigned a role to** Miguel Cruz — `events` |
| `member:delete` | Ana Reyes **deleted member** Miguel Cruz |
| `roster:bulk_add` | Ana Reyes **bulk-added to the roster** — 42 members |
| `seed:load` | Shared token · ci-dev **loaded seed data** |

Unknown or future action keys **must not blank the row**. `phraseFor` falls back to humanizing the key
itself: split on `:`, replace `_` with spaces (`event:foo_bar` → "event — foo bar"). The log stays
truthful about actions this build does not know about, which matters most when reading a log written by
a newer deploy.

`detail` renders as trailing muted context when present. It is free text written by repositories, so it
is rendered as text and never as markup.

### UI

Each row becomes: actor name (bold) + sentence + target link where one exists (events, links,
announcements, library items and members all have detail routes) + relative time ("2h ago") with the
absolute timestamp in a `title` attribute. Category badge stays for scanning. Filter chips stay.

Rows must survive long user-controlled names: per the project's mobile rule, name and target spans get
`min-w-0` and `break-all`, not `break-words`.

Adds an actor filter alongside the existing category filter — `?actor=<memberId>` — since "what did this
person do" is the question the log is opened for.

### Scope guard

`audit.list` keeps its existing `hasAnyAdminScope` check. Name resolution runs **after** that check and
adds no new read surface: an admin who can already read the log can already read these names elsewhere.

### Files touched (Part 4)

| File | Change |
|---|---|
| `src/lib/audit-phrasing.ts` | new — action table, fallback humanizer, sentence builder |
| `src/lib/audit-phrasing.test.ts` | new — every known action, unknown-key fallback, shared-token attribution, deleted actor |
| `src/db/repositories/audit.ts` | `AuditEntryView`, batched actor/target resolution, actor filter |
| `src/app/portal/admin/system/audit/page.tsx` | sentence rows, target links, relative time, actor filter |

### Test plan (Part 4)

- `phraseFor` returns a distinct phrase for each of the 39 known keys, and no phrase is the raw key.
- Unknown key `event:brand_new` humanizes rather than blanking.
- `describeAudit` on a `shared_dev_token` entry never emits the member name and always emits the token
  label.
- Null `actorMemberId` renders "Deleted member".
- Repository integration: 100 mixed-type entries resolve with a bounded query count (assert the batching
  actually batches, not N+1); a deleted target resolves to null label without throwing.

## Part 5 — Shareable event link (`/events/<CODE>`)

### Decision

Members only, with a sign-in bounce. An unauthenticated visitor goes to `/signin?next=/events/<code>`
and lands on the event after login. Nothing about the event is exposed to the public internet.

### Route placement

`/[slug]` at the app root is the short-link redirector (the replacement for the removed `/l` route) and
matches exactly **one** path segment. `/events/<code>` is two segments, so there is no collision and no
change to the links system. Verified in `src/app/[slug]/route.ts`.

### Code generation — short and human-speakable, not a UID

The code is **6 characters** from a 30-symbol alphabet that omits every visually ambiguous glyph:

```
ABCDEFGHJKMNPQRSTVWXYZ23456789
```

Dropped: `I`, `L`, `O`, `U`, `0`, `1`. `I/L/1` and `O/0` are the pairs people mistype when reading a code
off a poster or a slide; dropping `U` additionally makes accidental profanity far less likely, which
matters for a code printed on club material.

That gives 30⁶ = **729,000,000** combinations, so a URL is `ateneocode.org/events/K7P2QM`. Codes are
stored uppercase and looked up case-insensitively, so a member typing `k7p2qm` still lands.

`src/lib/event-code.ts`:

```ts
export const EVENT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export const EVENT_CODE_LENGTH = 6;
export function generateEventCode(): string;         // crypto.getRandomValues, rejection-sampled
export function normalizeEventCode(raw: string): string | null;  // uppercase, validate, else null
```

Rejection sampling rather than `% 30` on a random byte: 256 is not a multiple of 30, so modulo would
bias the first 16 symbols of the alphabet upward. Cheap to do correctly, so it is done correctly.

Migration `0019` (same migration, additive):

```sql
ALTER TABLE crs_events ADD COLUMN public_code TEXT;

UPDATE crs_events SET public_code = (
  substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1) ||
  substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1) ||
  substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1) ||
  substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1) ||
  substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1) ||
  substr('ABCDEFGHJKMNPQRSTVWXYZ23456789', (abs(random()) % 30) + 1, 1)
) WHERE public_code IS NULL;

CREATE UNIQUE INDEX crs_events_public_code_idx ON crs_events (public_code);
```

SQLite evaluates `random()` once per call, so the six terms are independent. The backfill runs before
the unique index, so a collision across existing rows fails the migration loudly instead of silently
mis-routing a share link. At current event volume a collision is vanishingly unlikely; if the migration
ever does trip, rerunning the `UPDATE` for the null rows clears it.

New rows generate their code in the repository via `generateEventCode()`, retrying up to 5 times on a
unique-constraint violation before surfacing an error.

The column stays nullable in Drizzle to match rows created by an older Worker mid-deploy; the resolver
treats a null code as "not shareable" rather than throwing.

Codes are **not** derived from the event id. A derived code would leak row ordering and creation volume;
a random one leaks nothing.

### Resolver is a resolver, not an auth bypass

`src/app/events/[code]/route.ts` — a `GET` route handler, not a page:

1. `normalizeEventCode(params.code)` first — uppercase and shape-validate. A malformed code 404s without
   touching the database, so the route cannot be used as a query-load amplifier.
2. Look up the event by the normalized `public_code`, selecting **only** `id` and `deletedAt`. It must
   never select `checkin_secret`; that column is what gates QR check-in, and this is the one route
   reachable by an unauthenticated request.
3. No match, or soft-deleted → 404. Not a redirect, so a wrong code cannot bounce someone through
   sign-in only to fail afterwards.
4. No actor → `302 /signin?next=/events/<code>`.
5. Actor present → `302 /portal/calendar/<id>`.

Authorization is deliberately **not** re-implemented here. The redirect lands on the existing event page,
which applies the normal visibility rules. The code shortens a URL; it never grants access. Enumerating
codes reveals only whether a code exists, and only to someone who then still has to sign in.

`next` is validated against a leading-slash-and-no-scheme pattern before use, so the parameter cannot be
turned into an open redirect.

### Share UI

Event detail page gains a "Copy link" control showing `{APP_BASE_URL}/events/{code}`, using the existing
`APP_BASE_URL` config rather than a hardcoded host. Read-only events are shareable too — sharing is
orthogonal to interaction.

## Part 6 — Add to Google Calendar (and .ics)

### Decision and its ceiling

Plain "Add to Google Calendar" plus an `.ics` download. **Setting other people's RSVP status is not
achievable this way and is out of scope**: the Google Calendar template URL can only prefill a form in
the clicking user's own calendar. Writing an event into another member's calendar, or setting their
"going" status, requires the Google Calendar API with an OAuth write scope, per-member token storage and
refresh, and Google app verification — a project of its own.

The `?add=` parameter was also rejected on privacy grounds: it would place member email addresses in a
URL, and URLs leak through history, referrers and share sheets.

Result: no new dependency, no new OAuth scope, no PII in any URL.

### Implementation

New pure module `src/lib/calendar-export.ts`:

```ts
export function googleCalendarUrl(event: CalendarExportEvent, shareUrl: string): string;
export function icsFor(event: CalendarExportEvent, shareUrl: string): string;
```

Timed events use UTC basic format: `dates=20260812T010000Z/20260812T030000Z`.

**All-day end dates are exclusive in both formats.** An all-day event on Aug 12–14 must emit
`dates=20260812/20260815` for Google and `DTEND;VALUE=DATE:20260815` for ICS.

Concretely (review finding D4): we store the inclusive last instant, `Aug 14 23:59:59.999+08`, which
converts to the calendar day `2026-08-14`. Emitting that directly truncates the exported event by a day.
The exporter must **add one calendar day to the inclusive `endDate`** — never to the raw timestamp,
which would land at `Aug 15 23:59:59.999` and export two days long. Both the off-by-one and the
double-add get a dedicated unit test.

`.ics` is served from `src/app/events/[code]/event.ics/route.ts` returning `text/calendar`, so mobile
Safari and Outlook handle it natively. It reuses the Part 5 resolver's member-only rule. ICS text
escaping (commas, semicolons, newlines in title/place/description) is applied per RFC 5545, and long
lines are folded at 75 octets.

The description embeds the Part 5 share link, so an event added to someone's calendar links back.

Buttons live on the event detail page next to "Copy link".

## Part 7 — "Radio" renamed to "Multiple choice"

UI label only. `src/app/portal/calendar/event-signup-form-editor.tsx:11` changes
`{ value: "radio", label: "Radio" }` to `label: "Multiple choice"`.

**The stored key stays `"radio"`.** Changing it would require migrating every `rsvp_form_json` blob on
`crs_events` plus every saved answer on `event_rsvps`, for zero user-visible benefit. The key is an
internal identifier; the label is the product surface.

Verified the key is read in `src/lib/event-signup-form.ts`, `event-signup-panel.tsx`,
`surveys/[id]/page.tsx` and `events.integration.test.ts` — none of them render the string "Radio" to a
user, so the label change is contained to the one line.

Noted but **not** changed without a decision: the sibling option is labelled "Select", which is the same
kind of jargon. Say the word and it becomes "Dropdown" in the same one-line style.

## Adversarial review log (2026-08-05)

Two Codex reviews, each verified against real source. A first single large review hung after ~40 tool
calls with no output and was killed; splitting it into two narrow reviews with hard call budgets and
fixed output formats worked.

### Security review

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| R1 | CRITICAL | `update()` authorizes via `canManage` (`events.ts:333-335`), which an event **owner** passes at `:166-168` without holding `event:moderate`. A plain owner could flip `read_only` on their own event through the generic update path. | **Accepted.** The gate must be **field-level** inside `update()`: if `patch.readOnly !== undefined && patch.readOnly !== event.readOnly`, require `can(actor, "event:moderate")` regardless of `canManage`. Stating the rule in prose was not enough — it has to be enforced against the specific line that lets owners through. |
| R2 | CRITICAL | Planned guards omitted `removeRetiredAward` (`events.ts:491`, delete at `:502-505`), leaving point configuration mutable on a read-only event. | **Accepted, on consistency grounds rather than the stated one.** The method can only *remove* awards, so it grants nobody points and is not an escalation. But the spec promises collected rows are preserved, and `setAwards` throws — leaving its sibling open is the kind of inconsistency that reads as an oversight later. Blocked, with the same escape hatch already documented for `undoScan`: flip read-only off, clean up, flip back. |
| — | — | Q3: no mutation path bypasses the three repositories. Direct `db` use in `scan/route.ts:36-38,82-84` is rate limiting only. | Confirms the repository-layer enforcement choice covers both server actions and HTTP routes. |

### Date and query review

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| D1 | CRITICAL | `coalesce(endsAt, startsAt) >= monthStart` admits an event ending exactly at `monthStart`, which has zero overlap under half-open `[start, end)` semantics. | **Accepted.** Split into `endsAt > monthStart` for spans and `startsAt >= monthStart` for point events. |
| D2 | CRITICAL | An event ending exactly at UTC+8 midnight maps forward a day through `toIsoDate`, rendering every such multi-day bar one day too long. | **Accepted.** `endDate` derives from `endsAt - 1ms`, floored at the start day. |
| D3 | MEDIUM | `buildMonthGrid` is Monday-first/0-indexed; `calendar-month.tsx` is Sunday-first/1-indexed; the create-event picker uses the former. | **Accepted as a constraint, not a fix.** Bars use the calendar's own Sunday-first array; unifying is out of scope. |
| D4 | HIGH | Storing the inclusive `Aug 14 23:59:59.999` and emitting it as an exclusive end truncates exports by one day. | **Accepted.** Exporter adds one day to the inclusive `endDate`, never to the timestamp. |
| D5 | HIGH | `calendarItemSchema` (`contract/calendar.ts:6`) is `.parse()`d at `internal/calendar.ts:51`; `z.object` strips unknown keys, so new `CalendarItem` fields vanish silently on the shared dev Worker. | **Accepted — this was a genuine blind spot.** Neither contract file appeared in the original file list. Both ship with the type change. |

Q5 also confirmed no existing test asserts `CalendarItem`'s exact shape
(`calendar.integration.test.ts:51,78` only map and filter), so the field additions break no test.

## Open risks

1. **Week-row restructure is the largest visual diff.** The month grid's borders, today highlight and
   mobile min-heights all currently live on flat cells. Regression risk is layout, not logic.
2. **Mobile density.** Three lanes plus a day number in a `min-h-20` cell on a 375px viewport is tight.
   Mitigation: bars shrink to a 14px lane height under `sm`, and the per-day overflow count absorbs the
   rest. Needs a real device check.
3. **`undoScan` throwing on read-only** could strand an organizer who flipped the flag with a bad scan
   still recorded. Accepted: they can flip read-only off, undo, and flip it back.
