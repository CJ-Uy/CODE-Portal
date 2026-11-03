# Retention parts and feedback split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure retention as 8 point-type parts (4 yearly, 4 per semester, 1 point per slot), split the
points of events that have a feedback form 75/25, and redesign `/portal/retention` around the parts.

**Architecture:** Each part is a point type with a `retention_period` column. One pure module,
`src/lib/retention-parts.ts`, turns records into slots and a status, and every screen calls it through
the retention repository. The feedback split lives in SQL inside `src/db/repositories/event-awards.ts`,
so check-in, award edits and answering all share one rule.

**Tech Stack:** Next.js App Router on Cloudflare Workers (OpenNext), Drizzle ORM on D1/SQLite, Vitest
Workers pool, Tailwind v4 with the local `src/components/ui` primitives.

**Spec:** `docs/superpowers/specs/2026-10-23-retention-parts-design.md`

## Global Constraints

- `src/db/schema.ts` is the only schema source. One migration, `drizzle/migrations/0016_retention_parts.sql`. It stays unapplied.
- No D1 command, no deploy, no push. Commit to `claude/retention-categories-6744d6` only. Commits get no AI co-author trailer (memory `feedback-no-claude-coauthor-trailer`).
- Tests are `.ts` only, run with `pnpm test:workers`. No render tests.
- The split is a fixed `ATTENDANCE_SHARE = 0.75`, rounded to 2 decimals in SQL with `round(x, 2)`. The share is `round(award - attendance, 2)`.
- `RETENTION_SLOT_POINTS = 1`.
- Copy follows the DESIGN.md writing rules: no em dashes, plain words, short labels.
- Keep edits small in the files the feedback session owns: `surveys.ts`, `surveys/[id]/page.tsx`, `calendar/[eventId]/*`, `portal/page.tsx`, `send-panel.tsx`.

## Review Focus

- A check-in by the event owner or staff on an event with a form: they get 100%, because they can never answer. Covered by a test in Task 3.
- An award edited after members answered: the attendance share and the feedback share must still sum to the new award. Covered by a test in Task 3.
- A 2nd semester that hasn't started: its slots read `upcoming`, never `missed`. The status stays `on_track`. Covered by a test in Task 2.
- A negative manual correction in a slot: counted points clamp at 0, and the slot is not met. Covered by a test in Task 2.
- A term with a null `second_semester_starts_at` (old Worker or old fixture): falls back to the midpoint. Covered by a test in Task 2.

---

### Task 1: Schema and migration

**Files:** modify `src/db/schema.ts`. Create `drizzle/migrations/0016_retention_parts.sql` (plus the drizzle-kit meta snapshot and journal). Modify `scripts/verify-preservation.ts` if it asserts seeded rows. Update every test fixture and seed that writes `retainedAt`/`probationBelow`.

**Produces:**
- `pointTypes.retentionPeriod: text("retention_period").$type<RetentionPeriod>()`, nullable.
- `terms.secondSemesterStartsAt: integer("second_semester_starts_at", { mode: "timestamp_ms" })`, nullable.
- `retentionPeriod`'s type, `RetentionPeriod = "year" | "semester"`, exported from the schema.
- `RetentionRecordSource` gains `"feedback_share"`.
- Index `retention_records_share_event_member_type_idx` on (event_id, member_id, point_type_id) `WHERE source = 'feedback_share'`.
- `terms.retainedAt` and `terms.probationBelow` are removed.

- [ ] Edit the schema, then run `pnpm db:generate`. Review the emitted SQL and rename it `0016_retention_parts.sql` (fix the journal tag).
- [ ] Hand-write the data steps below the DDL, in the 0014 style:
  - `INSERT OR IGNORE` the 8 types from spec "Builder check answers" item 1, placed at `COALESCE(MAX(position), -1) + n`.
  - `UPDATE point_types SET retention_period = 'year' WHERE id IN (...) OR key IN (...)`, and the same for `'semester'`.
  - Backfill `second_semester_starts_at = (strftime('%s', strftime('%Y', (ends_at + 28800000) / 1000, 'unixepoch') || '-01-11') - 28800) * 1000` where that value falls between `starts_at` and `ends_at`.
- [ ] Run `pnpm exec tsx scripts/verify-trunk.ts`. Expected: `CONVERGED`. Run `pnpm exec tsx scripts/verify-preservation.ts`. Expected: pass.
- [ ] Remove the threshold fields from fixtures, the seed and `src/app/api/auth/e2e/route.ts`, then run `pnpm typecheck`. Remaining errors are only in the code later tasks replace.
- [ ] Commit `feat(retention): add retention parts and semester schema`.

### Task 2: Pure retention module

**Files:** create `src/lib/retention-parts.ts` and `src/lib/retention-parts.test.ts`. Put `ATTENDANCE_SHARE` in `src/lib/points.ts`.

**Produces:**
```ts
export const RETENTION_SLOT_POINTS = 1;
export type PartType = { id: string; label: string; retentionPeriod: RetentionPeriod | null; position: number };
export type SchoolYear = { startsAt: Date; endsAt: Date; secondSemesterStartsAt: Date | null };
export type PartRecord = { pointTypeId: string; points: number | null; countsOn: Date };
export type SlotState = "met" | "open" | "missed" | "upcoming";
export type RetentionSlot = { key: string; label: string; startsAt: Date; countsUntil: Date; earned: number; counted: number; overflow: number; pending: number; state: SlotState };
export type RetentionPart = { pointTypeId: string; label: string; period: RetentionPeriod; slots: RetentionSlot[] };
export type RetentionStatus = "retained" | "on_track" | "not_retained";
export type RetentionProgress = { status: RetentionStatus; met: number; required: number; missed: number; parts: RetentionPart[]; nextDeadline: { at: Date; parts: string[] } | null };
export function semesterBoundary(year: SchoolYear): Date; // explicit date, else the midpoint
export function buildRetentionProgress(types: PartType[], year: SchoolYear, records: PartRecord[], pending: PartRecord[], now: Date): RetentionProgress;
export function pointTotals(records: { pointTypeId: string; points: number | null }[]): Map<string, number>; // quantized
```
`countsUntil` is the instant before the next window starts (sem 1: boundary − 1 ms; year and sem 2: `endsAt`). Slot labels are `"School year"`, `"1st semester"` and `"2nd semester"`. `nextDeadline` is the earliest `countsUntil` ≥ now among unmet slots, with the labels of the parts still due then.

- [ ] Write the tests first:
  - **12 slots:** 4 yearly + 4 semestral types give `required: 12`, ordered by `position`.
  - **Overflow:** 3 GMA in sem 1 gives `counted: 1`, `overflow: 2`, and sem 2 stays unmet.
  - **Sums:** 0.75 + 0.75 meets a slot. A −2 correction gives `counted: 0`.
  - **Semester windows:** a sem 1 slot unmet after the boundary is `missed`, and the status is `not_retained`. Before the boundary, sem 2 is `upcoming` and the status is `on_track`.
  - **Pending:** 0.25 pending shows in `pending` and never counts toward `met`.
  - **Midpoint fallback:** a null boundary falls back to the midpoint.
  - **Retained:** all 12 met gives `retained`.
  - **Not parts:** types with `retentionPeriod: null` produce no part.
  - **Next deadline:** lists the unmet parts due at the earliest deadline.
- [ ] Run `pnpm vitest run src/lib/retention-parts.test.ts`. Expected: FAIL (module missing).
- [ ] Implement it. Run the tests again. Expected: PASS. Commit `feat(retention): compute part slots and status`.

### Task 3: Feedback split in SQL

**Files:** modify `src/db/repositories/event-awards.ts`, `src/db/repositories/events.ts` (setAwards, undoScan) and `src/db/repositories/surveys.ts` (answerAward, respondentState walk-in check, draft defaults, send copy and points). Tests go in `src/db/repositories/events.integration.test.ts` and `src/db/repositories/surveys.integration.test.ts`. Follow their existing fixtures.

**Produces:**
- `buildFeedbackShareUpsert(db, eventId: string, memberId?: string)` returns a `retention_records` INSERT…SELECT with source `feedback_share`. It joins attendance records, active `event_point_awards`, `surveys` (by event) and completed `survey_assignments`. Points are `round(award − attendance, 2)` where that is greater than 0. `recorded_at` is `completed_at` and `recorded_by` is the survey's `created_by`. On conflict on the share index it updates points.
- The scan and existing-attendance upserts pay `round(points × 0.75, 2)` when a survey with this `event_id` exists and the member is neither the event's `created_by` nor in `event_staff`. Their reason gains ` (75% now, 25% for the feedback form)` in that case.
- `setAwards` also runs `buildFeedbackShareUpsert(db, eventId)` after the attendance upsert, and its delete covers both `event_attendance` and `feedback_share`. `undoScan` deletes both sources.
- In `answerAward`, a survey with `eventId` returns `[buildFeedbackShareUpsert(db, survey.eventId, memberId)]`. It is placed after the assignment write in both submit paths. A survey without an event keeps `points_award`.
- `respondentState` opens an event form to every checked-in non-staff member (`allowWalkIn` is ignored).
- `create`/`createFromTemplate` with an `eventId` default to 0 points and no type. `send` forces `pointsAward: 0` for event forms, and its notice line says "Answer to get the other 25% of this event's points."

- [ ] Write the failing integration tests:
  - With a form, a scan writes 0.75 of a 1-point award. Without a form it writes 1. A staff scan writes 1.
  - Submitting writes a 0.25 `feedback_share` and no Feedback point.
  - Scanned before the form existed: 1 at check-in, and submit writes no share.
  - `setAwards` from 1 to 2 after answering gives attendance 1.5 and share 0.5.
  - `undoScan` removes the share.
  - A non-sampled attendee can answer with `allowWalkIn: false`.
  - A survey with no event still awards `points_award`.
- [ ] Run `pnpm vitest run src/db/repositories/events.integration.test.ts src/db/repositories/surveys.integration.test.ts`. Expected: the new tests FAIL.
- [ ] Implement it. Run the tests again. Expected: PASS. Commit `feat(feedback): split event points 75/25 around the feedback form`.

### Task 4: Retention repository and contract

**Files:** modify `src/db/repositories/retention.ts`, `retention-unavailable.ts`, `pointTypes.ts`, `overview.ts`, `src/db/contract/retention.ts` (+ test) and `src/server/internal/retention.ts`. Tests go in `retention.integration.test.ts`, `terms.integration.test.ts`, `pointTypes.integration.test.ts` and `overview.integration.test.ts`.

**Produces:**
- `PointTypeRow.retentionPeriod: RetentionPeriod | null`. `upsertType` refuses to retire a type that has a `retentionPeriod`. The `pt_retention` guard is removed.
- `TermAdminRow` and `TermUpsertInput` drop the thresholds and gain `secondSemesterStartsAt: Date | null` (required on upsert). The boundary must fall after `startsAt` and on or before `endsAt`.
- `MyHistorySummary = { termId; termName; startsAt; endsAt; secondSemesterStartsAt: Date | null; recordCount }`.
- `MyHistoryRecord` gains `eventStartsAt: Date | null`.
- `PendingShare = { eventId; eventTitle; surveyId; closesAt: Date | null; eventStartsAt: Date; pointTypeId; points }`.
- `myHistory()` returns `{ summary, records, pendingShares: PendingShare[], progress: RetentionProgress | null }`.
- `memberProgress(actor, { memberId, termId }, now?)` returns `RetentionProgress | null` (self or `retention:record`). It replaces `getMemberTermSummary`.
- `termProgress(actor, termId, memberIds: string[], now?)` returns `Map<string, RetentionProgress>` (`retention:record`).
- `eventFeedbackShare(actor, eventId)` returns `{ hasForm: boolean; pending: { pointTypeId; label; points }[] }`. `pending` is the viewer's own unanswered share.
- `OverviewSummary.retention` becomes `{ termName: string; progress: RetentionProgress } | null`.
- A shared internal helper, `loadProgress(db, memberIds, termId, now)`. It runs one records query and one pending query.
- The contract output schemas mirror these shapes. `source` enums add `feedback_share`.

- [ ] Write the failing integration tests:
  - `myHistory` gives the part slots and `pendingShares` for a running form.
  - Pending excludes answered forms and closed forms.
  - `upsertTerm` rejects a boundary outside the term.
  - `upsertType` rejects retiring `pt_gma`.
  - `overview.getSummary` returns `met`/`required`.
  - `eventFeedbackShare` gives `hasForm` true for a draft form.
- [ ] Run the tests. Expected: FAIL. Implement them. Run again. Expected: PASS.
- [ ] Commit `feat(retention): serve part progress from the repository`.

### Task 5: Admin surfaces

**Files:**
- `src/app/portal/admin/system/school-years/{input.ts,school-years-manager.tsx}` (and its test if there is one)
- `src/app/portal/admin/system/point-types/point-types-manager.tsx`
- `src/app/portal/admin/data/page.tsx`
- `src/app/portal/admin/members/[id]/page.tsx`
- `src/app/portal/admin/content/surveys/[id]/send-panel.tsx`
- `src/components/portal/overview-metrics.tsx`

**Consumes:** Task 4.

- [ ] **School years:** a required `secondSemesterStartsOn` date input. It defaults to the stored value, else the midpoint. `parseTermUpsertInput` parses it to Manila midnight. Test the parse in its `.test.ts`.
- [ ] **Point types:** a read-only "Retention" column showing "Each year", "Each semester" or "Not counted". The retire toggle is disabled for parts.
- [ ] **Data overview:** "Below probation" becomes "Missed a requirement" (`termProgress`, top 5 by `missed`, meta "N missed"). Add a "Feedback form not sent" list: ended events whose form is a draft.
- [ ] **Member page:** render the shared `RetentionParts` component from Task 7 in place of the probation line. Until then, show `RetentionStatusLine`.
- [ ] **Send panel:** for `hasEvent`, show one line in place of the walk-in toggle and the points input: "Every attendee can answer. They get 75% of the event's points at check-in and the other 25% when they answer."
- [ ] Run `pnpm typecheck`. Commit `feat(retention): admin views for parts, semesters and the split`.

### Task 6: Member surfaces outside the retention page

**Files:**
- `src/app/portal/page.tsx` (home tile)
- `src/app/portal/profile/{page.tsx,point-breakdown.ts}`
- `src/app/portal/calendar/[eventId]/page.tsx`
- `src/app/portal/surveys/[id]/page.tsx`
- new `src/components/feedback-share-note.tsx`

**Consumes:** Task 4 (`eventFeedbackShare`, `overview.retention.progress`).

- [ ] **Home tile and profile:** status badge plus "N of 12 retention requirements met". `buildPointBreakdown`'s `retention` becomes `retentionPeriod !== null`. Update its test.
- [ ] **`FeedbackShareNote`**, a single component with `{ hasForm, pending }` props. Insert one line on the event page next to the points, and one line on the form page in place of the points sentence when the form belongs to an event.
- [ ] Run `pnpm typecheck`. Commit `feat(feedback): show the 75/25 split on event and form pages`.

### Task 7: Retention page redesign

**Files:**
- rewrite `src/components/retention-history.tsx`
- new `src/components/retention-parts.tsx`
- modify `src/app/portal/retention/page.tsx` and `point-type-selection.ts` (+ test)
- delete `src/components/retention-charts.tsx`, `retention-category-progress.tsx` and the unused parts of `retention-stats.ts` and `retention-categories.ts` (move `competitionRanks` to `src/lib/leaderboard.ts`)

**Consumes:** Task 4's `myHistory` output and Task 2's types.

- [ ] Invoke the impeccable skill. Pull Mobbin references (progress or requirements trackers, checklist bars). Design inside DESIGN.md (Unna, Source Sans, navy/blue palette, tokens in `globals.css`).
- [ ] Build the page as one screen:
  - a header with the school year select, status, "N of 12 met" and the next deadline;
  - the pending feedback list;
  - `RetentionParts`, one row per part with a bar per slot, showing fill, the 1-point minimum, "Counts until <date>", overflow as "+N extra, not counted", and the pending hatched segment;
  - the next upcoming event that awards an unmet part (one query over upcoming events with awards);
  - a "How retention works" disclosure;
  - a "Not counted toward retention" group;
  - milestone progress, rebuilt;
  - activity history, labelled by point type, with a counted/not-counted cue.
- [ ] Remove the stat tiles, the charts and the pie/race. The leaderboard tab defaults to the first part type and drops the `retainedAt` prop.
- [ ] Run `pnpm typecheck && pnpm lint`. Commit `feat(retention): redesign the member page around the 8 parts`.

### Task 8: Verify and hand over

- [ ] Run `pnpm test:workers`, `pnpm typecheck`, `pnpm lint` and `graphify update .`. Expected: all pass.
- [ ] Local signed-in preview (memory `local-signed-in-preview-recipe`) on a scratch sqlite copy seeded with part records, a pending share and overflow. Take desktop and 390px screenshots of `/portal/retention`, plus the home tile and the event page note.
- [ ] Write a hand-over note in the shared notes folder: branch, migration file, merge notes (no new flags, bindings or secrets), the decisions list and the manual check list. Commit the docs.
