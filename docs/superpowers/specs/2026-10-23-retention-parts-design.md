# Retention parts and the feedback points split

Date: 2026-10-23. Branch: `claude/retention-categories-6744d6`, landing on `beta` first.

## Why

The portal measures retention as one running total (`pt_retention` points) against a school-year target
(`terms.retained_at`, with `terms.probation_below` for probation). That is not how OSG retention works. CJ
corrected the model on 2026-10-23, and the member points page has to show the real one. In the same
change, events with a feedback form split their points: most of them at check-in, and the rest when the
member answers the form.

Prod data already fits the real model. Its 397 records all use the typed point types (GMA, HRE, ADVO,
CBTB, KSA and so on), and none use `pt_retention` (memory `staged-dummy-points-seed`). Prod and staged
have one point type for each retention part. Only the counting and the page are wrong.

## The model (agreed with CJ)

Retention is 8 parts. Each part is an existing point type, matched by `point_types.key`:

| Part | key | Period | Needs |
|---|---|---|---|
| Training Seminar | `ts` | school year | 1 point |
| Project Team | `proj_team` | school year | 1 point |
| Advocacy-Related | `advo` | school year | 1 point |
| Engagement Team | `egmt_team` | school year | 1 point |
| General Membership Activity | `gma` | each semester | 1 point per semester |
| Human Resources Event | `hre` | each semester | 1 point per semester |
| Community Building Team Bonding | `cbtb` | each semester | 1 point per semester |
| Knowledge-Sharing Activity | `ksa` | each semester | 1 point per semester |

That gives 12 requirements in a school year: 4 yearly ones plus 4 parts × 2 semesters. Call each one a
**slot**.

- A member is **retained** for a school year only when every slot is met.
- A semestral part needs 1 point in **each** semester. A missed 1st-semester slot cannot be made up in the
  2nd semester.
- A slot is met by points, not by event count. Records in the slot sum, fractions included: 0.5 + 0.5
  meets it, and so does 0.75 + 0.75.
- Points past 1 in a slot are **overflow**. Overflow never helps retention: it does not carry into
  another slot or another part. It still counts toward that point type's milestones.
- Every other point type is **not retention**: Retention (`pt_retention`), Feedback, Project Head, the
  Eligibility types, and anything an admin creates. These count on their own and never attach to
  retention. The UI says so plainly.
- The status words are **Retained** (every slot met), **On track** (no slot has closed unmet) and **Not
  retained** (at least one slot's period ended unmet). There is no probation.
- **Milestones** are per point type, as today. They count every point of that type in the school year,
  overflow included.

### Semesters

A `terms` row is a school year: Admin → School years, with a name and start and end dates in Manila
time. It gains one date, **2nd semester starts**.

- 1st semester runs from the school-year start to the moment before that date. It includes June–July
  intersession.
- 2nd semester runs from that date to the school-year end.

Each slot shows the date it **counts until**: the school-year end for yearly parts, the last day of the
1st semester for 1st-semester slots, and the school-year end for 2nd-semester slots.

*My call:* a record's semester comes from its event's `starts_at` when the record is linked to an event,
and from `recorded_at` otherwise. A late manual entry for a 1st-semester event therefore still lands in
the 1st semester. A record only ever counts in the school year it is filed under (`term_id`).

## The feedback split (agreed with CJ)

The split is fixed: 0.75 and 0.25. It is not admin-configurable. It applies when the event has a feedback
form, which means a `surveys` row whose `event_id` is the event. The event-creation checkbox the feedback
polish session is building is not what decides this.

- **At check-in**, an attendee of an event with a form gets 75% of each of the event's point awards,
  rounded to 2 decimals. An event without a form gives 100%, as today.
- **On submitting** that event's form, the member gets the rest: for each point type they have an
  attendance record for, the full award minus what check-in gave. This uses a new record source,
  `feedback_share` (see Data). Because the amount is "the full award minus what check-in gave", a member
  who checked in before the form existed already has 100% and gets nothing more. The same rule makes the
  two parts always add up to the award, whatever the rounding.
- **Every attendee can answer.** An event's form is always open to every checked-in member, whether or
  not they were in the random sample. `allow_walk_in` stops mattering for event forms, and the send
  panel stops offering the toggle for them.
- **Form closes unanswered:** the remaining share is lost for good.
- **The separate "points for answering"** (`surveys.points_award`, by default 1 Feedback point) no longer
  applies to event forms, because the share replaces it. Surveys with no event keep `points_award`
  exactly as today.
- **Existing records are not rewritten** by the migration.
- *My call:* the event's owner and its staff (admins and scanners) cannot answer its form; they give
  feedback through the debrief. They always get 100% at check-in.
- *My call:* when an event's awards are edited (`setAwards`), the attendance re-upsert applies the 75%
  rule using whether the event has a form *now*. The shares of members who already answered are
  re-upserted to "award minus attendance", so the two still sum to the new award. Shares for an award
  type that was removed are deleted, the same way attendance records are.
- *My call:* undoing a scan deletes that member's `feedback_share` records for the event along with the
  attendance records.

### Where members see the split

The split has to be prominent to members, not left in fine print:

- **Event page**, next to the point chips, when the event has a form: "This event has a feedback form.
  You get 75% of these points when you check in, and the other 25% when you answer the form."
- **Form page**: the line "You'll get N points for answering" is replaced by the member's own pending
  share, for example "Answering gives you the other 25% of this event's points: +0.25 General Membership
  Activity". The text is worded for whatever share is actually left.
- **Retention page**: every pending share shows on its part's bar as a hatched segment marked "answer
  the form". Above the bars, a short list names each open form with a pending share, its points, its
  closing time and a link.

## Data

All schema changes go in `src/db/schema.ts` plus one hand-written migration, `0016_retention_parts.sql` (renumbered from 0015 after beta took 0015 for important links).
It stays unapplied until CJ approves the `pnpm exec wrangler` command.

- `point_types.retention_period`: text, nullable, either `'year'` or `'semester'`. Null means the type is
  not a retention part. The minimum is a code constant, `RETENTION_SLOT_POINTS = 1`, not a column: every
  part needs 1 and nothing asks for it to change.
- `terms.second_semester_starts_at`: integer `timestamp_ms`, nullable, so a row written by an older
  Worker mid-deploy still works. When it is null, readers fall back to the school year's midpoint. The
  admin form requires the date on save.
- `terms.retained_at` and `terms.probation_below` are dropped.
- `retention_records.source` gains `'feedback_share'`. The column is plain text; the type union, the
  contract enums and `sourceLabel` change. A new partial unique index on (event_id, member_id,
  point_type_id) `WHERE source = 'feedback_share'` gives one share per member per type per event.
- **Migration steps:**
  1. `INSERT OR IGNORE` the 8 part types, using prod's ids, keys and labels, placed after the current
     maximum `position`. This only adds rows on beta and local; prod and staged already have them.
  2. Set `retention_period` **by key**. Keys never change, but ids could differ between databases.
  3. Backfill `second_semester_starts_at` with a guess: 11 January (00:00 Manila) of the year the school
     year ends in, when that date falls inside the school year. Otherwise leave it null. CJ will correct
     the date in Admin → School years.
  4. Drop the two columns.
  5. Add the new index.

  Extend `scripts/verify-preservation.ts` if it covers seeded rows.
- `pt_retention` stays as an ordinary point type. The "cannot be retired" guard is removed. The
  `retention_records.point_type_id` column default stays as it is, since changing it would mean
  rebuilding the table.
- Known gap: between running the migration and deploying, the old Worker selects the dropped columns, so
  term-reading pages error for those minutes. This is accepted on beta. The usual order is migrate, then
  deploy at once.

## Logic

One pure, tested module, `src/lib/retention-parts.ts`, takes:

- the part point types (`id`, `label`, `retentionPeriod`, `position`);
- the school-year window (`startsAt`, `endsAt`, `secondSemesterStartsAt | null`);
- the member's records for that school year (`pointTypeId`, `points`, `source`, the date used for the
  semester, `eventId`);
- pending shares, and `now`.

It returns:

- **Per part:** one or two slots. Each slot has its label, its window, when it counts until, earned
  points, counted points (`clamp(earned, 0, 1)`), overflow (`max(0, earned − 1)`), the pending share, and
  a state. The state is one of `met`, `open` (window running, not met), `missed` (window ended, not met)
  or `upcoming` (window not started).
- **Overall:** status (`retained`, `on_track` or `not_retained`), slots met, and slots required.
- **Other points:** a total per non-retention point type.

Every surface that shows retention calls this module, so no two screens disagree.

## Screens

- **Member page `/portal/retention`**: a redesign, done with the impeccable skill and Mobbin references,
  keeping CODE branding (`DESIGN.md`). It is one screen with:
  - a header showing the school year, the status, "N of 12 met" and the next deadline;
  - the pending-feedback list;
  - the 8 part rows, one bar per slot, each with its minimum, fill, counts-until date, overflow shown as
    visibly not counting, and the hatched pending share;
  - a labelled "Not counted toward retention" group with the other point types;
  - rebuilt milestone progress;
  - the activity history.

  The stat tiles, the "Progress this term" chart, the "Points by week" chart and the category
  pie/bar-race block are removed, along with their code (`retention-charts.tsx`, most of
  `retention-stats.ts` and `retention-category-progress.tsx`). `competitionRanks` moves next to the
  leaderboard. The leaderboard tab stays as it is, except it loses the `retainedAt` target line.
- **Portal home tile**: shows the status and "N of 12 retention requirements met" instead of points
  toward a target.
- **Profile**: the same status line. In the point breakdown, `retention` means "is a part".
- **Admin member page**: shows the same part bars, read-only, for that member and school year, in place
  of the probation line.
- **Admin data overview**: "Below probation" becomes "Missed a requirement", meaning members whose
  status is `not_retained`, with the number of missed slots.
- **Admin point types**: a read-only "Retention" column showing Each year, Each semester or —.
- **Admin school years**: the retained and probation fields are removed and a required "2nd semester
  starts" date is added. It must fall after the school-year start and on or before its end.
- **Admin survey send panel** (a file the feedback session is editing; keep the edit small): for event
  forms, the walk-in toggle and the points-for-answering input are replaced by one line explaining the
  25% share.
- **Shared-dev contract** (`src/db/contract/retention.ts`): the output schemas follow the new shapes.

## Constraints

- Tests run in the Workers pool: `.ts` only, no component render tests. The logic lives in pure helpers
  and repository integration tests.
- Keep edits small in the files the feedback polish session is editing: `src/db/repositories/surveys.ts`
  (only `answerAward`, `respondentState`'s walk-in check, the draft defaults and send copy),
  `src/app/portal/surveys/[id]/page.tsx`, `src/app/portal/calendar/[eventId]/*`,
  `src/app/portal/page.tsx` and `send-panel.tsx`. Prefer a new small component plus a one-line
  insertion.
- No D1 migration, seed, deploy or push without approval of the exact `pnpm exec wrangler` command.

## Builder check answers (my calls, 2026-10-23; CJ said to decide and list)

1. **Part rows.** These were read from staged D1, which holds prod's point types under the same ids:

   | id | key | label |
   |---|---|---|
   | `pt_ts` | `ts` | Training Seminar |
   | `pt_proj_team` | `proj_team` | Project Team |
   | `pt_advo` | `advo` | Advocacy-Related |
   | `pt_egmt_team` | `egmt_team` | Engagement Team |
   | `pt_gma` | `gma` | General Membership Activity |
   | `pt_hre` | `hre` | Human Resources Event |
   | `pt_cbtb` | `cbtb` | Community Building Team Bonding |
   | `pt_ksa` | `ksa` | Knowledge-Sharing Activity |

   The `retention_period` update matches `id = ... OR key = ...`, so a database whose ids drifted still
   gets marked. After merging, check that `SELECT count(*) FROM point_types WHERE retention_period IS NOT
   NULL` returns 8.
2. **A form that never launches.** "Has a form" includes drafts, because forms are usually drafted at
   event creation, before check-in. If a draft is never sent, the 25% is lost, the same as a form that
   closes unanswered. To make officers notice, the admin data overview gains a "Feedback form not sent"
   list: ended events whose form is still a draft.
3. **Retiring a part.** A retention part cannot be retired, and the old guard on `pt_retention` moves to
   "any type with `retention_period`". The module counts every part type, active or not.
4. **Who gets a status.** Every member is measured over the same 12 slots. There is no join-date
   exemption: OSG has stated no such rule, and CJ can raise one. The admin "Missed a requirement" list
   uses the members the data overview already lists, those with activity in the school year.
5. **Leaderboard.** The member tab already ranks by the chosen point type (`publicLeaderboard`). Its
   default type becomes the first retention part instead of `pt_retention`. The admin `leaderboard()`
   operation has no UI caller and stays as it is.
6. A member who already has 100% from check-in gets no `feedback_share` row, not a zero row. A share
   record uses the same term as the member's check-in.

## Out of scope

- Admin editing of which point types are parts. That needs a developer and a migration.
- Per-year history of part definitions. Changing the parts rewrites how past years read.
- Prod rollout and `FEATURE_RETENTION` on prod.
- Removing staged's `ret_seed_%` dummy rows.

## Done means

- The migration is written and unapplied.
- Logic and repository tests pass, along with `pnpm test:workers`, `pnpm typecheck` and `pnpm lint`.
- Desktop and 390px screenshots of the redesigned page from a local signed-in preview.
- A short list of what CJ should check by hand.
