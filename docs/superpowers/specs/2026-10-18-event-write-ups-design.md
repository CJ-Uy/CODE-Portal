# Event Write-ups for the Library — Design

Date: 2026-10-18
Status: Draft for review. Open questions in section 13.
Owner: CJ (portal), on behalf of the Office of the Secretary-General (OSG), who run the Central Registration System (CRS)
Builds on: `2026-10-16-event-feedback-design.md` (sections 11 and 16) and `2026-10-16-library-v2-design.md`

## 1. Intent

On 2026-10-18 OSG decided that only CRS may browse the event archive (`/portal/admin/data/events`). Planners who are not CRS admins must not open it. Instead, CRS publishes results that are already interpreted and contextualised, as Library articles that every member can read (event-feedback spec, section 16, decision 4).

Nothing connects the two today. A CRS admin who wanted to share what an event taught would have to copy numbers off the results page by hand, retype the debrief, and pick comments, all while the results page shows each respondent's name next to their comment. That is slow, and one careless paste puts a name in front of every member.

This feature adds one guided step: from an event in the archive, a CRS admin opens "Write up for the Library", picks what goes in, writes a short takeaway, and gets a Library draft with the numbers written as text, the chosen quotes without names, and the organizers' debrief. They finish it in the normal Library editor and publish it through the normal Library flow.

### Why now

The event feedback system and Library v2 both went live on beta on 2026-10-18. OSG's decision only works once CRS has a quick, safe way to publish, so planners are not left with nothing.

### What success looks like

- A CRS admin turns a closed event into a published write-up in about ten minutes, most of it spent writing the takeaway.
- A planner preparing a similar event finds it in the Library (Type filter or search) and learns what worked, what didn't, and what to change, without archive access.
- No published write-up ever carries a respondent's name.

## 2. Current state

### 2.1 What exists and is reused

- **Feedback results.** `surveyResults.getResults(actor, surveyId, { filter })` in `src/db/repositories/survey-results.ts` returns `SurveyResults & ResultsRespondents` (`src/db/types.ts:223-245`). `SurveyResults` carries no identities: scale summaries (`n`, `counts`, `mean`, `topTwoPct`), the same-type `baseline`, choice counts, and text answers as `{ id, value, hidden }`. The names live only in `ResultsRespondents` (`respondents`, `answerNames`). The organizer path (`getOrganizerResults`) already builds results without names.
- **View helpers** in `src/lib/feedback/results-view.ts`: `invitedLine`, `isLowResponseRate`, `baselineLine`, `percentOf`, `closingLine`. `metricLabel` in `src/lib/feedback/editor-input.ts`. `effectiveStatus` and `RESULTS_MIN_RESPONSES` (3) in `src/lib/feedback/stats.ts`.
- **Debrief.** `eventDebriefs.get(actor, eventId)` and `DEBRIEF_FIELDS` in `src/lib/feedback/debrief-input.ts`: four After Action Review answers (intended, happened, why, change).
- **Archive detail.** `/portal/admin/data/events/[id]` (gated by `retention:record`) renders `EventFeedbackSections` (`event-feedback-sections.tsx`) when `FEATURE_SURVEYS` is on and the actor has `survey:configure`.
- **Admin results page** `/portal/admin/content/surveys/[id]` (gated by `survey:configure`).
- **Library drafts.** `library.createDraft(actor, input)` (`src/db/repositories/library.ts:524`) already accepts `kind`, `format`, `title`, `dek`, `authors`, `year` and `blocks`. The creator becomes the owner. `createDraftAction` in `src/app/portal/library/editor-actions.ts` shows how the author name is defaulted.
- **Library blocks** in `src/lib/library/blocks.ts`: heading, text, list, quote (with optional `cite`), callout, divider and others. Text goes through the strict inline parser in `src/lib/library/inline.ts` (`**bold**`, `*italic*`, `https://` and `mailto:` links only).
- **Library publishing.** `publishAction` asks the client-data question. "No" goes live at once; "Yes" goes to `pending_review` for a `library:moderate` holder. Moderators can take any item down. Only the owner publishes a draft. Members never delete; only `library:manage` deletes.
- **Library visibility.** `members` items are readable by every signed-in member when `FEATURE_LIBRARY` is on. `confidential` items are readable only by `library:manage` and the item's owner (`canSeeItem` in `src/db/repositories/library-access.ts`), and only `library:manage` can set confidentiality. Owners and `library:moderate` holders can edit an item, drafts included (`canEditItem`).
- **Kind validation.** The editor's input schemas validate `kind` with `z.enum(LIBRARY_KINDS)` (`src/app/portal/library/editor-input.ts:35`), and `createDraftAction` uses them. Adding a kind to `LIBRARY_KINDS` therefore makes it creatable through the normal "New" path unless the server refuses it.
- **Member event page** `/portal/calendar/[eventId]` is readable by every signed-in member for any event that is not deleted (`calendar.getEvent`). It is not part of the archive.
- **No CHECK constraint on `library_items.kind`** (`0013_library_v2.sql`), so a new kind needs no migration.
- **Flags.** `FEATURE_LIBRARY` and `FEATURE_SURVEYS` are on in `wrangler.beta.jsonc` and off in `wrangler.jsonc` (prod). Staged's flags are set outside the repo config; probe the environment rather than reading config.

### 2.2 What is missing

- No link between a Library item and an event.
- No Library type for an event write-up. The existing types each mean something else here (section 4.2, call 1).
- No way to turn results into Library blocks. No chart block exists, and none should be added for this.
- Members were never told their answers might be quoted to other members. The form says: "CRS can see your name with your answers so they can follow up. Organizers see the answers without names. Used only to evaluate this project (RA 10173)." (`src/app/portal/surveys/[id]/page.tsx:58`). The invitation email carries the first two sentences only (`src/lib/feedback/email.ts:44`). The reminder email carries no notice.
- The seeded demo form `srv_demo_past` is kept running on purpose, so admins can try extending, reminding and closing it (`src/db/seed/data.ts:277`, asserted in `src/db/seed/feedback-demo.integration.test.ts:74`). There is no closed demo form.
- `getResults` returns names on the same object as the results. Passing that object to a client component would send every name to the browser.

## 3. Goals, non-goals, anti-goals

### Goals

1. A CRS admin can start a write-up from an event in a couple of clicks, from the archive or from the results page.
2. The draft arrives pre-filled: ratings as plain sentences with context, chosen quotes without names, the debrief, and CRS's own takeaway.
3. No respondent name can enter the draft through the pre-fill, and a check catches names typed or pasted in by hand before the first publish.
4. The write-up goes through the normal Library editor and publishing rules, and links back to the event's member page.
5. Members are told, on the form, that answers may be quoted without names, and answers given before that notice are never quoted.

### Non-goals

- **Charts in the Library.** Numbers become sentences. A chart block can come later if write-ups prove popular.
- **Live numbers.** A write-up is a snapshot taken when the draft is created. It does not update.
- **Roundups across several events** (for example "Every GA this year"). CRS can write a normal Article and embed the event write-ups with item blocks.
- **The AI comment summary in the write-up.** It stays an admin-only reading aid (event-feedback spec, section 10). Machine-written text never goes to every member.
- **The word cloud in the write-up.** Frequent terms can include names.
- **Write-ups for general surveys** (no event).
- **An event-type filter in the Library.** The Type filter plus search ("GA", "workshop") covers it. Add a facet when there are enough write-ups to need one.
- **Shared ownership of write-ups across the CRS team** (section 4.2, call 9).
- **Changing what organizers or CRS see in the archive.**

### Anti-goals (failure even if it technically works)

- A respondent's name appears in a published write-up, or a quote names someone from the event without the author noticing. (Names of people with no tie to the event are left to the author; section 8 explains why.)
- A write-up is only numbers with no interpretation. OSG asked for interpreted, contextualised results.
- The Library becomes a back door into the archive: the full comment list, the respondent list, or comments CRS hid from organizers reach members.
- A member's answer is quoted when they were not told it could be.
- Duplicate drafts pile up that nobody can delete.

## 4. Decisions

### 4.1 Decided already

- OSG (2026-10-18): only CRS browses the archive. CRS publishes interpreted, contextualised results as Library articles.
- OSG (2026-10-18): CRS sees respondent names; organizers do not. Both views stay as they are.
- Library v2: everything goes live at once unless it includes client data; moderators can take anything down; members never delete.

### 4.2 Calls made by Claude (flagged so CJ can override)

1. **A new Library type, `event_report`, shown as "Event report".** The existing types don't fit. `guide` is a how-to. `article` is a member's personal piece and defaults to source "From members". `case_study` in CODE means a client engagement, the kind of item most likely to hold client data. Mixing event write-ups into any of these muddies the Type filter that planners would use. Defaults: format `page`, source `code` ("Made by CODE"), public readiness `not_eligible`, because the quotes are members' words given for internal evaluation. Moderators can change readiness as usual. (Open question 2.)
2. **Write-ups are only created through the write-up step, enforced on the server.** The generic Library "New" page and the editor's type picker do not offer `event_report`. Hiding the option is not enough (section 2.1, kind validation), so the editor's input schemas validate against a list without `event_report`, and the repository refuses `event_report` in `createDraft` without a `sourceEventId` and refuses any kind change to or from it in `updateItem`. This keeps the type meaning "CRS's reading of a real event".
3. **Confidentiality defaults to `members`.** That is the whole point: every planner can read it. `confidential` would hide it from everyone but `library:manage` and the owner, which defeats the purpose. CRS cannot set confidentiality anyway (only `library:manage` can). A write-up that shouldn't reach all members shouldn't be published.
4. **Normal Library approval.** The CRS author answers the client-data question like any author. "No" goes live at once; "Yes" goes to a library moderator. Moderators can take a write-up down or edit it, as with any item. Event write-ups get no extra approval step. CRS is the office OSG chose to publish these, and the name check (call 6) covers the specific risk. (Open question 3.)
5. **Names are kept out in three layers.**
   - *Structural.* The write-up step loads results through a function that returns `SurveyResults` with `respondents` and `answerNames` dropped by explicit picking, not by spreading the object and deleting keys. Only that identity-free object reaches the builder and the browser. The quote picker never shows names, unlike the admin results page.
   - *Server-chosen quote text.* The browser sends only the ids of the chosen answers. The server looks the text up again, and rejects ids that are unknown, from another survey, or hidden from organizers.
   - *A name check* (call 6) on the comments in the picker and on the whole draft at first publish.
6. **The name check warns and asks for confirmation; it does not hard-block.** Names are matched against everyone connected to the event: attendees, respondents, the owner and event staff. Respondents are listed explicitly because an undone scan (`undoScan`, `src/db/repositories/events.ts:786`) can remove an attendance row after the member answered. Because the set is wider than "who answered", a match never reveals who answered. A match shows only the matched words from the author's own text, labelled "Looks like the name of someone at this event". Publishing a draft with matches needs a tick: "I checked these. None of them names someone who answered the form." A hard block would stop legitimate credits ("Thanks to our speaker, Ana Cruz") and common-word collisions. (Open question 4.)
7. **Quotes need notice.** A new `surveys.library_quotes` flag records whether the form told members that answers may be quoted. Existing forms keep `false`. Forms created after this ships get `true`, and the form, the invitation email and the member guide say so. The write-up step offers quotes only from forms with the flag on. For older forms it says why there are no quotes, and CRS describes what people said in their own words. (Open question 1.)
8. **Comments hidden from organizers can never be quoted.** CRS hid them because they were unfair or personal. Showing them to every member would be worse.
9. **One write-up per event, one owner.** A partial unique index on `library_items.source_event_id` enforces it. The CRS admin who starts it owns it under normal Library rules: only they can publish it, and only they and library moderators can edit it. Another CRS admin sees "Write-up by Ana Cruz · Draft" instead of a start button. This prevents duplicate drafts that members can't delete. The cost: if the owner leaves CODE, the item becomes ownerless and only moderators can manage it, which is the same as any Library item today. (Open question 5.)
10. **A write-up needs final numbers or a debrief, and never starts while a form is pending.**
    - If the event has a form that is a draft or still running, nothing can start yet ("Write-up opens when the form closes"). Otherwise a debrief-only write-up started early would keep the ratings and quotes out for good.
    - If the form is closed (by hand or past `closes_at`) with at least 3 responses, the write-up can use ratings, quotes and the debrief.
    - If the form is closed below 3 responses, or there is no form, the write-up can start only when the debrief has at least one answer, and uses the debrief alone.
11. **The owner can rebuild their own draft.** While the write-up is still a draft, its owner can open the write-up step again. It starts from the event's current data, and its button reads "Replace the draft's content". After a confirm, the action replaces the draft's title, summary and blocks; tags and authors stay. This is how CRS fixes a wrong pick of quotes without retyping them, which would skip the server-side quote checks. Once the write-up leaves draft, the step only links to it.
12. **CRS's takeaway is required.** The write-up step has a required field, "What should planners take from this?" (20 to 2000 characters). This makes "interpreted" a step in the flow rather than a hope. It becomes the first section of the draft, and CRS can rewrite it in the editor.
13. **Link back through a column, not a block.** `library_items.source_event_id` points at the event. The item page shows "About the event: <title> · <date>", linking to the member event page `/portal/calendar/<id>`, never to the archive. The member event page links back with "Read what we learned" once the write-up is published and the viewer can see it.
14. **A sharing warning.** If CRS turned "Share results with organizers" off for this form, the write-up step warns: "This form's results aren't shared with the event's organizers. A Library write-up can be read by every member, organizers included."
15. **The debrief is included by default.** It was written so the next planner could learn from it (event-feedback spec, section 5, step 10). CRS can untick it or edit it. The debrief form gains one line: "CRS may share this debrief in a Library write-up."
16. **An audit row** (`library:create_event_report`, with the event id) records who started each write-up.

## 5. Entry points

The write-up step lives at `/portal/admin/data/events/[id]/write-up`, inside the CRS-only archive. Two places link to it. Both are shown only when `FEATURE_LIBRARY` and `FEATURE_SURVEYS` are on and the actor has both `survey:configure` and `retention:record`.

1. **Archive detail, Feedback section** (`event-feedback-sections.tsx`). A "Library write-up" row under the feedback summary. It shows one of:
   - "Write up for the Library" (button), when call 10 allows it.
   - "Write-up opens when the form closes", while the event's form is a draft or still running.
   - "Nothing to write up yet", with no closed form above the threshold and no debrief.
   - The existing write-up: title, status badge and owner. The owner gets "Continue" and "Rebuild from feedback" (draft, call 11) or "Open" (any other status). Another CRS admin gets "Open" only when the item is published; otherwise just the line.
2. **Admin results page** (`/portal/admin/content/surveys/[id]`). A "Write up for the Library" button in the header, for event forms only, under the same conditions. This is where CRS reads the results, so it is where the idea comes up.

The Library's own "New" page gets no entry. Planners who are not CRS admins never see the step.

## 6. The write-up step

`/portal/admin/data/events/[id]/write-up`. Server-rendered, mobile first. If a write-up already exists for the event:
- and it is the actor's own draft, the step opens in rebuild mode (call 11): the same page, starting from the event's current data, with the final button reading "Replace the draft's content" behind a confirm;
- otherwise it redirects to the item page (when the actor can see it) or back to the archive.

From top to bottom:

1. **Header.** "Write up <event title> for the Library". One line under it: "Every member can read Library write-ups. Names of the people who answered are never included."
2. **Warnings**, when they apply: the sharing warning (call 14), a low response rate ("Fewer than 3 in 10 invited answered. The write-up will say so.").
3. **Takeaway** (required). "What should planners take from this?" A textarea with a hint: "Two or three sentences: what worked, what didn't, and what you'd tell the next organizer."
4. **Ratings** (checkbox, on by default; shown only when the form passed call 10). Under it, a read-only preview of exactly the sentences the draft will get (section 7.2), produced by the same function.
5. **Quotes** (shown only when the form passed call 10 and `library_quotes` is on). The text answers, grouped by question, each with a checkbox. No names, no order by respondent, hidden comments left out. Answers the name check flags carry a "Mentions a name" marker with the matched words highlighted. They can still be picked; CRS edits them in the editor. At most 6 quotes (a named constant). When `library_quotes` is off: "Members answered this form before they were told answers might be quoted, so quotes aren't offered. Describe what people said in your own words in the takeaway."
6. **Debrief** (checkbox, on by default; shown only when at least one debrief answer exists). A read-only preview of the four answers.
7. **"Create Library draft"**. One server action:
   - Re-checks access, the flags and call 10.
   - Re-reads the identity-free results and the debrief. It never trusts preview text from the browser.
   - Validates the chosen answer ids (section 4.2, call 5).
   - Builds the blocks (section 7) and calls `library.createDraft` with `kind: "event_report"`, `sourceEventId`, the title, summary, year and authors (the actor, as `createDraftAction` does).
   - In rebuild mode, instead, it checks the item is still the actor's own draft for this event and calls `library.updateItem` with the new title, summary, year and blocks. Tags and authors are left alone.
   - Writes the audit row (`library:create_event_report` or `library:rebuild_event_report`).
   - Redirects to `/portal/library/<id>/edit`.
   - A unique-index violation (someone else started one at the same moment) redirects back with "A write-up for this event was just started."

## 7. What the draft contains

A pure function, `buildEventReport(input) → { title, dek, year, blocks }`, in `src/lib/feedback/` (builder picks the file name). Its input type has no name fields: the event (title, type label, start and end, attendance count), `SurveyResults` or null, the debrief answers or null, the chosen quotes grouped by question prompt, the takeaway, and the include flags.

### 7.1 Title, summary, year

- **Title:** "<event title>: what we learned". Editable.
- **Summary (dek):** "<Event type> on <date>. <N> attendees' feedback and the organizers' debrief, read by CRS." Leave out the parts that are missing.
- **Year:** the event's start year.

### 7.2 Blocks, in order

1. **Callout (note)**, the source line: "From the feedback form that closed on <date>: 31 answers (29 of 47 invited, 62%, plus 2 who answered on their own). 38 people attended." With no form: "From the organizers' debrief. 38 people attended."
2. **Heading "What planners should know"** and a text block with the takeaway.
3. **Heading "How attendees rated it"** (when ratings are included) and a list block, one line per scale or choice question, in form order:
   - Scale: "**Overall satisfaction:** 82% rated it 4 or 5 out of 5 (average 4.3, 31 answers). Past workshops average 4.2 across 12 events." The label is the metric label for tracked questions and the prompt otherwise. The second sentence comes from the existing baseline and its thresholds, and is left out when there is no baseline.
   - Choice: "**The pace was:** About right 70%, Too fast 20%, Too slow 10% (30 answers)."
   - After the list, when the invited response rate is low, a text block: "Fewer than 3 in 10 invited people answered, so treat these numbers as a rough signal."
4. **Heading "In their words"** (when quotes are picked). For each question with picked quotes, a level-3 heading with the question prompt, then one quote block per answer with no `cite`.
5. **Heading "The organizers' debrief"** (when included). For each non-empty answer, a level-3 heading with the `DEBRIEF_FIELDS` label and a text block with the answer.

Everything is ordinary blocks. CRS can rewrite, reorder or delete any of it in the editor, add images, and tag the item.

## 8. The name check

A pure function, `findNames(text, candidates) → string[]`, plus a repository read for the candidates.

- **Candidates** for an event: the members in `crs_attendance` for it, the members linked to its form's responses (`survey_responses.member_id`), the owner (`crs_events.created_by`) and every `event_staff` member. For each: `full_name`, `name` and `nickname`, plus the last word of `full_name` as a surname.
- **Matching:**
  - Full names: case-insensitive, whole words, any run of spaces treated as one.
  - Single words (nickname, surname, a one-word name): whole word, case-sensitive (so "Joy" matches but "joy" does not), at least 3 letters, and not on a short stoplist of common English words that are also names ("Will", "May", "Grace" and the like). The builder writes the stoplist.
  - Compare after Unicode normalization so "Peña" matches "Pena".
- **Where it runs:**
  1. In the write-up step, over each candidate quote (the "Mentions a name" marker).
  2. In `publishAction`, for `event_report` items only, over the title, summary and the plain text of every block. With matches and no acknowledgement, it returns them instead of publishing. The publish dialog lists them and offers "Back to editing" or the tick plus "Publish". The acknowledgement goes in the audit row.
- **What it never does:** say who answered, or show a candidate name that is not already in the author's text.
- **Why only people tied to the event.** Matching all members (hundreds of names) would flag most write-ups for common first names and surnames, and a warning that always fires gets ticked without reading. The people a comment is most likely to name are the ones who were there or ran it. Names of anyone else are left to the author.
- **Known ceiling.** It runs before the first publish only. Later edits to a published write-up, by the owner or a moderator, are not checked. Leave a `ponytail:` comment naming this; a check on every save of an `event_report` is the upgrade if it ever matters.

## 9. Data model

All changes go through `src/db/schema.ts` and one generated migration. The next free number on beta is `0015`; renumber at build time if something lands first. The local runner reads the migrations directory, so do not change it to read drizzle's journal.

- **`library_items.source_event_id`**: text, nullable, foreign key to `crs_events.id` with `on delete set null`. A partial unique index on it `WHERE source_event_id IS NOT NULL`.
- **`surveys.library_quotes`**: boolean, not null, default `false`, so every existing form stays unquotable. Both survey insert paths in `src/db/repositories/surveys.ts` (blank drafts near line 261 and template drafts near line 382) set it to `true`.
- **`LibraryKind`** gains `event_report` in `src/lib/library/taxonomy.ts`: `KIND_LABELS` ("Event report"), `defaultFormat` (`page`), `defaultSource` (`code`), `defaultPublicReadiness` (`not_eligible`). No migration: `kind` has no CHECK constraint.
- **Library repository:** `createDraft` accepts `sourceEventId` and refuses `event_report` without one. `updateItem` refuses a kind change to or from `event_report`.
- **Editor input:** `createDraftInputSchema` and `saveItemInputSchema` in `src/app/portal/library/editor-input.ts` validate `kind` against a list without `event_report` (for example `MEMBER_KINDS`), so a hand-crafted form post can't create or switch to one. A new read, `findForEvent(actor, eventId)`, returns `{ id, title, status, ownerName, isMine }` or null, ignoring visibility because only the write-up step and the archive call it; the member event page instead uses a read that applies normal Library visibility and returns only a published, visible item.
- **Types:** `LibraryItem` picks up `sourceEventId` from the schema. The item page needs the event's title, start date and `deleted_at` to render or hide the chip.

## 10. Surfaces that change

| Surface | Change |
|---|---|
| `/portal/admin/data/events/[id]/write-up` | New page and server action (sections 6 and 7) |
| `event-feedback-sections.tsx` | "Library write-up" row (section 5) |
| `/portal/admin/content/surveys/[id]` | "Write up for the Library" button (section 5) |
| `/portal/library/[id]` | "About the event" line under the header chips, hidden when the event is deleted |
| `/portal/library/[id]/edit` and `publish-dialog.tsx` | Type picker hides `event_report`; the publish dialog shows the name matches (section 8) |
| `editor-actions.ts` `publishAction` | Name check for `event_report` items; accepts the acknowledgement |
| `/portal/library/new` | No change (it lists kinds explicitly and `event_report` is not added) |
| Library search filters | "Event report" appears in the Type filter automatically through `LIBRARY_KINDS` |
| `/portal/calendar/[eventId]` | "Read what we learned" link when a published, visible write-up exists |
| `/portal/surveys/[id]` form note | When `library_quotes` is on, add: "CRS may quote answers, without names, in a write-up other members can read." |
| `src/lib/feedback/email.ts` invitation | The same sentence when `library_quotes` is on. The reminder email stays as it is; the form itself always shows the notice before anyone answers. |
| `src/components/feedback/debrief-form.tsx` | One line: "CRS may share this debrief in a Library write-up." |
| `src/lib/guides/content.ts` | Member guide (answering a form): the quote sentence. CRS guide: a short "Write up an event for the Library" section. Reshoot screenshots only where the copy shows in them. |

All user-controlled text (event titles, quotes, matched names) uses `min-w-0` and `break-all` or `[overflow-wrap:anywhere]`, per the project's mobile overflow rule.

## 11. Permissions and flags

| Who | Can |
|---|---|
| CRS (`survey:configure` and `retention:record`) and `super` | Open the write-up step and create a write-up draft for any event |
| The write-up's owner | Edit and publish it under normal Library rules, and rebuild it from feedback while it is a draft |
| `library:moderate` | Approve (if it went to review), take down, restore, edit, retag, set public readiness, as for any item |
| `library:manage` | Everything above, plus confidentiality and delete |
| Every signed-in member | Read a published `members` write-up, save, comment, report |

- The write-up step needs `FEATURE_LIBRARY` and `FEATURE_SURVEYS` both on. Each entry point hides when either is off.
- No new flag. On prod both flags are off, so nothing shows there.
- `APP_ENV=shared` keeps the unavailable Library and Surveys repositories, so no internal contract or shared-dev proxy changes are needed. The schema change still follows CLAUDE.md's dev Worker rule.

## 12. Environments, migration, tests

- **Migration** `0015` (two columns and one partial index; no table rebuild). Before applying to beta D1, show the exact `pnpm exec wrangler` command and wait for approval, as with every D1 operation. Then follow CLAUDE.md for the dev Worker path.
- **Seed:** leave `srv_demo_past` running; it is kept open on purpose and a test asserts it. Add a second synthetic demo event with a closed form (`library_quotes = true`, about 8 responses with spread, one comment that names an attendee, one comment hidden from organizers) and a debrief, so every part of the write-up step can be checked locally. Update `src/db/seed/feedback-demo.integration.test.ts` to match.
- **Tests** run in the Workers Vitest pool: `.ts` only, no jsdom, no render tests, no better-sqlite3 import.
  - `buildEventReport`: each section on and off, the no-form path, a below-threshold form, low response rate, a baseline present and absent, choice questions, empty debrief answers skipped.
  - **The structural guard:** feed the loader a `SurveyResults & ResultsRespondents` whose names are distinctive strings, and assert the serialized output of both the loader and `buildEventReport` contains none of them.
  - Name candidates: a respondent whose scan was undone is still a candidate.
  - `findNames`: full-name case and spacing, case-sensitive single words, minimum length, stoplist, accents (Peña/Pena), a name inside a longer word not matching.
  - Repository: `createDraft` with `sourceEventId`; `event_report` without `sourceEventId` rejected; a second write-up for the same event rejected by the unique index; kind change to or from `event_report` rejected; `findForEvent` for owner and non-owner.
  - Editor input: `createDraftInputSchema` and `saveItemInputSchema` reject `kind: "event_report"`.
  - Server action: answer ids from another survey, hidden answers, unknown ids, and any ids when `library_quotes` is off are all rejected; a draft or running form blocks the step, even with a debrief; a debrief-only write-up works when there is no form; rebuild replaces only the actor's own draft and is refused once the item has left draft.
  - `publishAction`: an `event_report` with a matching name returns the matches without publishing; with the acknowledgement it publishes and audits it; other kinds are unaffected.
- **E2E** (existing Playwright setup), optional: as CRS, write up the seeded event, publish, then as a plain member find it under Type = Event report and follow the event link. Run the mobile viewport too.

## 13. Open questions for CJ

Most important first. Each has a recommended default the builder can use if CJ agrees.

1. **Quoting members.** The form tells members their answers are "Used only to evaluate this project (RA 10173)" and that only CRS and organizers see them. Is quoting them, without names, in a members-only write-up acceptable once the form says so? And is it right to never quote forms answered before the notice (call 7)? This is a privacy-notice change, so OSG may want to approve the wording. *Recommended: yes to both, with the wording in section 10. Check the wording with OSG before it reaches prod.*
2. **The Library type.** A new "Event report" type (call 1), or reuse "Case study"? *Recommended: the new type. Case study already means a client engagement in CODE.*
3. **Approval.** Should write-ups go live at once under normal Library rules (call 4), or wait for a library moderator or OSG to approve each one? *Recommended: normal rules. Add a forced review later if a bad write-up ever gets through.*
4. **Name check strictness.** Warn and ask for a tick (call 6), or block publishing until no match remains? A hard block would also stop speaker credits and words that happen to be names. *Recommended: warn and tick.*
5. **Who can edit a write-up.** One owner, as with every Library item (call 9), or any CRS admin? Letting any CRS admin edit and publish `event_report` items means a Library permission exception keyed on the item's type. *Recommended: one owner for now.*
6. **Organizers and the debrief.** The debrief goes in by default (call 15). Should organizers be told before their debrief is published, or asked to agree? *Recommended: no extra step. The debrief was written for future planners, and the new line on the debrief form tells them it may be shared.*

## 14. Left to the builder

- Component and file names, and whether the write-up step's quote picker reuses parts of `comments-panel.tsx` (it must not render names either way).
- Exact copy, within the meaning given here.
- The stoplist contents and the `findNames` edge cases beyond section 8.
- The quote cap (6 is the starting value) and the takeaway length limits.
- Whether the archive list (`/portal/admin/data/events`) gets a "Write-up" marker column. Not required.
- Whether the item page also shows CRS viewers a direct link to the archive entry. Not required.
- Inline markup inside quotes and debrief answers: the inline parser renders `*text*` as italic and turns `[label](https://…)` into a link. Leaving it is acceptable, because only `https://` and `mailto:` links render and CRS reviews every quote. Escaping it is also fine.

## 15. Later (explicitly deferred)

- A chart block for the Library.
- Roundups across several events.
- An event-type facet in the Library filters.
- Shared CRS ownership of write-ups.
- Running the name check on every save of a published write-up.
- Notifying organizers when a write-up of their event is published.
