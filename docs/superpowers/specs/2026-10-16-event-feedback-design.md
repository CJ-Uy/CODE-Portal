# Event Feedback, Interpretation, and Event Archive — Design

Date: 2026-10-16
Status: Draft for review
Owner: CJ (portal), on behalf of the Office of the Secretary-General (OSG), who run the Central Registration System (CRS)

## 1. Intent

OSG collects post-event evaluations through the "CRS Form", a Google Form. Today that form does three jobs at once: it confirms attendance (ID number, last name, event dropdown), it gates retention points ("Retention Points are only awarded AFTER submission of this form"), and it collects the evaluation (one required "what did you like most", a 1-5 satisfaction grid for Event Flow / Content / Venue / Overall, one optional "how can we make this better"). It closes at 11:59 PM on the event day.

The portal already took over the first two jobs: QR check-in records attendance in `crs_attendance` and awards points at scan time. What is left is the evaluation, and the evaluation is the part that is weakest today. Because the form gates points, members fill it to get the points, not to give feedback. The two sample submissions we have are both straight 5s with "EVERYTHING" and "The format" as the free-text answers. That is textbook satisficing (Krosnick, 1991): respondents give the minimum answer that unlocks the reward.

This feature moves the evaluation into the portal and makes it worth reading:

- CRS admins pick a standard feedback form, adjust it for the event, and send it to attendees: everyone, or a random sample sized from attendance.
- Invited members get a portal notification and (optionally) an email. Any attendee can also open the form from the event page and answer on their own.
- Admins get an interpretation view: rating distributions, averages with context, comparison against past events of the same type, a searchable comment list with a word cloud, and a quiet, optional machine-drafted summary of the comments.
- Each past event keeps its feedback plus a short organizer debrief, so people planning the next event can look back at what worked.

### Why now

The survey engine was built in Phase 6 but never connected to events, and its delivery path is broken (see 2.2). The email system and event-attendee audiences shipped on 2026-10-05, so the pieces needed for delivery now exist.

### What success looks like

- OSG can retire the Google Form evaluation for portal events.
- Feedback answers are honest enough to act on: spread in the ratings, specific comments.
- A planner can open the archive, filter to past events of the same type, and see scores, recurring themes, and what the last organizers said they would change.

## 2. Current state

### 2.1 What exists and is reused

- `surveys`, `survey_questions`, `survey_assignments`, `survey_responses`, `survey_answers` in `src/db/schema.ts`. Responses are anonymous by design: `survey_responses` has no member column; `survey_assignments` records who was invited and whether they completed.
- `src/db/repositories/surveys.ts`: create, seeded random sample (`seededSample` in `src/lib/sample.ts`), submit, aggregate results (counts per value, raw text list).
- Admin pages at `/portal/admin/content/surveys` and `/portal/admin/content/surveys/[id]`; member page at `/portal/surveys/[id]`.
- `notify()` in `src/db/repositories/notifications.ts` (gated by `FEATURE_NOTIFICATIONS`).
- Email campaigns (`src/db/repositories/email-campaigns.ts`) with audiences; audience rules already support `kind: "member"` and `kind: "event"` with `relation: "attended"`.
- Per-minute cron in `custom-worker.ts` (already used for scheduled email).
- Admin event roster at `/portal/admin/data/events/[id]`, gated by `retention:record` (the CRS role; `crs` is an alias of `retention` in `src/server/auth/permissions.ts`).
- Hand-built SVG chart components in `src/components/retention-charts.tsx` and `src/components/links/charts.tsx`. No chart library is installed and none should be added.
- `FEATURE_SURVEYS` is on for beta only.

### 2.2 What is broken or missing

- **Delivery is broken.** `sample()` generates a response token per member, but `sampleSurveyAction` discards the returned tokens and the notification links to `/portal/surveys/<id>` with no `?t=`. The member page then says the link is missing its token. No invited member can currently answer.
- Sampling draws from all active members, not from event attendees.
- No templates, no per-question required flag, no help text, no custom scale labels (the member page hard-codes "Strongly disagree / Strongly agree").
- No closing date, no reminder.
- Results are raw counts and an unordered text list. No charts, no comparison, no summary.
- `survey:configure` is not granted to any role, so only `super` can use surveys today.
- No place to record an organizer debrief, and no archive view.
- The cron is not universal. `custom-worker.ts:36` returns early when `FEATURE_EMAIL !== "true"`, and prod (`wrangler.jsonc`) has no cron trigger at all. Only beta and staging run the per-minute cron.
- Organizers are not all in `event_staff`. The event owner is `crs_events.created_by` and has no staff row (`src/db/repositories/events.ts:295`); ownership transfer deletes the new owner's staff row (`events.ts:653`).
- Everything under `/portal/admin` is gated by `src/app/portal/admin/layout.tsx:13` (`hasAnyAdminScope`). A plain-member organizer cannot reach any admin page, whatever the page's own check says.
- Email campaign writes require `email:send` (`email-campaigns.ts:124, :154`) and a `senderId`. Audiences allow at most 100 include rules (`src/lib/email/blocks.ts:71`) and are resolved at dispatch time (`src/server/email/dispatch.ts:33-34`).
- Surveys have no shared-dev proxy. In shared mode the repository is `createUnavailableSurveysRepository()` (`src/db/repositories/index.ts:137`). Only the server-side handler `src/server/internal/surveys.ts` behind `/internal/surveys` exists.
- A public, token-based submit route exists at `src/app/api/surveys/submit/route.ts` with contract op `submit` (`auth: "public"`, `src/db/contract/surveys.ts:72-77`).

## 3. Goals, non-goals, anti-goals

### Goals

1. Admins with the CRS role can create an event's feedback form from a standard template, edit it, and send it in a few minutes.
2. Delivery works end to end: notification, optional email, event-page entry, sign-in, answer, done.
3. Random sampling draws from that event's attendees and suggests a sample size from attendance.
4. Results are interpreted, not just counted, and are comparable across events.
5. Every event's feedback and debrief live in one archive view usable during planning.

### Non-goals

- Replacing RSVP/sign-up (the "CRS Sheet"). Out of scope.
- Changing how points are awarded. Points stay with QR check-in.
- A general-purpose form builder (logic branching, file uploads, matrix grids, multi-select).
- Member-facing results ("you said, we did" pages). Worth doing later; not now.
- CSV export of feedback. The admin exports area can add it later.

### Anti-goals (failure even if it technically works)

- Feedback feels mandatory or tied to points again. That brings the straight-5s back.
- The form takes longer than about three minutes. Response rates fall off fast.
- The AI summary becomes the headline. It must stay secondary, grounded in quotes, and easy to ignore.
- Admins can work out who wrote a given comment from the UI.
- Editing a template quietly breaks comparisons across events.

## 4. Decisions

### 4.1 Decided by CJ

- Admins send feedback forms to event attendees, either to everyone or to a random number of people chosen from those who were there.
- Attendees can also give feedback on their own through the site.
- Delivery uses the notification and email systems.
- There is a standard set of forms. The CRS admin picks one and can modify it right before sending.
- Results include charts, word clouds, averages for rating scales, and a summary of key points that is not in your face.
- An event archive on the admin side holds feedback so planners can refer to it.
- The science-based pipeline in section 5 is approved.

### 4.2 Calls made by Claude (flagged so CJ can override)

- **Points are decoupled from feedback.** Points come from QR check-in alone. Feedback is voluntary. (CJ's original framing implied this; OSG should confirm. See section 14.)
- **Responses stay anonymous**, as the existing engine was designed. The Google Form recorded email, ID and name; the portal will not link answers to members.
- **Results show only after 3 responses**, so a lone comment cannot be pinned on the one person who answered.
- **Tokens are dropped.** The member is signed in, so the server checks eligibility from the session. This fixes the broken delivery and removes the token column.
- **One feedback form per event.**
- **"Event staff" means the event owner (`crs_events.created_by`) plus every `event_staff` row** (admins and scanners). Staff are excluded from the sample and from answering. They write the debrief instead. This replaces the Google Form's "organizers must submit too". "Organizers" means the owner plus staff with the `admin` staff role.
- **General surveys (no event) survive unchanged in shape.** They sample from active members, are invite-only (no walk-ins), and use the same session-based delivery. Only event surveys get attendee sampling, walk-ins, and the archive.
- **Feedback email goes through a narrow path, not the email console's permission.** A dedicated email-repository method checks `survey:configure` instead of `email:send`. It uses the configured default sender and a "Feedback requests" category, and builds its audience from a new rule kind, `{ kind: "survey_invitees", surveyId }`. That rule resolves to the invited assignments, so there is no 100-rule limit and no leakage to non-sampled attendees at dispatch. These campaigns still appear in the email console, for transparency.
- **Reminder emails go to all invitees** with "thanks if you've already answered" wording, never to non-responders only. Otherwise the email console's recipient report would reveal who did not respond. The in-portal reminder notification, which only its recipient sees, goes to non-responders only.
- **The form closes 72 hours after the event ends** by default, not at midnight on the event day. One automatic reminder goes to invited non-responders 24 hours before close.
- **Questions are frozen once a form is sent.** Admins can extend the closing date or close early, but not change questions, because that would mix answers to different questions.
- **The archive lives on the existing admin events pages** (`/portal/admin/data/events` and `/[id]`), extended rather than duplicated.
- **The CRS (`retention`) role gets `survey:configure`.**
- **Organizers see their own event's feedback, under CRS control** (decided by CJ: "yes they can see it but also have controls in case CRS doesn't like it"). Claude's reading of "controls":
  - A per-form switch, "Share results with organizers". It defaults to on, sits on the send panel, and a CRS admin can flip it at any time. Turning it off hides the results from organizers immediately.
  - A per-comment "Hide from organizers" action, for comments CRS judges unfair or personal.
  Organizers never see the AI summary. A global default switch is skipped until CRS asks for one; there is no settings table to hold it today.
- **The AI summary uses Workers AI** (an `AI` binding). It is generated only on demand and never shown in lists.

## 5. The feedback pipeline

The pipeline follows established survey-methods practice. Each step names the reason behind it.

1. **Collect while memory is fresh.** Invitations go out right after the event. Recall of specific moments (pacing, venue problems) decays within days, so the default window is 72 hours: long enough for a weekend, short enough to stay accurate.
2. **Keep it short.** The standard form takes about two minutes: four or five rating questions plus one or two optional text questions. Free-text questions are optional by default. Required free text produces "EVERYTHING".
3. **Use labeled, consistent scales.** All rating questions in a template share one 1-5 scale with labeled ends. Satisfaction questions read "Very dissatisfied ... Very satisfied". The overall question comes first so the gut rating is not pulled toward the item ratings (part-whole order effect).
4. **Sample instead of always asking everyone.** A random sample of attendees, sized for a useful margin of error, gives a representative estimate with less fatigue across a semester of events. Everyone else who attended can still answer from the event page. Their responses are labeled as walk-ins, because self-selected respondents skew toward strong opinions.
5. **Remind once.** A single reminder reliably lifts response rates (Dillman's Tailored Design Method). One reminder, not more.
6. **Report response rate with every number.** "4.3 average" means little without "from 31 of 47 invited (66%)". Low response rates get a visible caution.
7. **Read ratings as distributions.** A 1-5 rating is ordinal. The results show the full distribution plus the share who answered 4 or 5 ("top-two box"), with the mean as a secondary figure. Two events can both average 3.5 while one is split between 1s and 5s.
8. **Compare like with like.** Rating questions carry a stable metric key (`overall`, `flow`, `content`, `venue`, `return_intent`, `learning`). Results compare against the average of past events of the same event type on the same metric. Comparisons are suppressed when there are too few responses or too few past events.
9. **Theme the comments, then verify.** Comments are browsable and searchable. The word cloud gives a quick view of what comes up. The optional machine summary drafts themes, but every theme must cite real quotes, and admins read the quotes before acting.
10. **Debrief and archive.** Organizers record a short After Action Review (what we set out to do, what happened, why, what we will change). The archive keeps it next to the feedback so the next planner can find it.

### 5.1 Suggested sample size

Shown on the send panel as a suggestion. The admin can always pick "everyone" or a custom number.

```
N  = eligible attendees (attended, not event staff)
n0 = (1.96 * 1.0 / 0.3)^2 ≈ 42.7      # ±0.3 margin on a 5-point item, SD ≈ 1
n  = n0 / (1 + (n0 - 1) / N)          # finite population correction
invite = min(N, ceil(n / 0.6))        # assume ~60% respond
```

Examples: N=30 gives 30 (everyone), N=80 gives 47, N=150 gives 56, N=300 gives 63. Plain-language label: "Suggested: invite 47 of 80 attendees. That's enough for averages accurate to about ±0.3." The 0.6 response assumption is a named constant. Recalibrate it once real response rates exist.

## 6. Standard templates

These are seeded by migration so every environment has them. Admins can edit them, add new ones, or archive them. "Tracked" means the question carries a metric key and feeds cross-event comparison.

### 6.1 Standard event feedback (default)

About two minutes.

1. Overall, how satisfied were you with this event? *(scale; Very dissatisfied ... Very satisfied; required; tracked: overall)*
2. Event flow: timing and order of activities. *(scale, same labels; help: "Was the time enough? Did the order make sense?"; required; tracked: flow)*
3. Content: talks, activities, discussions. *(scale; help: "Was it relevant and worth your time?"; required; tracked: content)*
4. Venue: space and equipment. *(scale; help: "Was the space enough? Did the equipment work?"; required; tracked: venue)*
5. How likely are you to attend a similar CODE event? *(scale; Not at all likely ... Very likely; required; tracked: return_intent)*
6. What was the most valuable part of the event? *(text; optional)*
7. What is one thing we should change next time? *(text; optional)*

Compared with the Google Form: ID, last name, event dropdown and the consent radio are gone, because the session and the event link already supply them. The consent text becomes a one-line privacy note on the form (anonymous; used only for project evaluation; RA 10173). "Liked most" is no longer required. "Make it better" becomes "one thing to change", which gets specific, actionable answers. Return intent is added because it is a better signal of whether people will come back than satisfaction alone.

### 6.2 Quick pulse

For small or recurring events. About 45 seconds.

1. Overall satisfaction *(required; tracked: overall)*
2. Likely to attend a similar event *(required; tracked: return_intent)*
3. Anything we should know? *(text; optional)*

### 6.3 Workshop / learning session

1. Overall satisfaction *(required; tracked: overall)*
2. I learned something I can use. *(scale; Strongly disagree ... Strongly agree; required; tracked: learning)*
3. Content: was it clear and relevant? *(scale; satisfaction labels; required; tracked: content)*
4. The pace was... *(choice: Too slow / About right / Too fast; required)*
5. Likely to attend a similar event *(required; tracked: return_intent)*
6. What should the next session cover? *(text; optional)*

## 7. Data model

All changes go through `src/db/schema.ts` and a generated migration (next is `0012`). The local runner reads the migrations directory, so do not change it to read drizzle's journal.

### 7.1 `surveys` (alter)

- `template_id` (nullable FK to `survey_templates`, `set null`). Provenance only.
- `closes_at` (timestamp, nullable; required once sent).
- `sent_at` (timestamp, nullable).
- `allow_walk_in` (boolean, default true).
- `share_with_organizers` (boolean, default true).
- `email_invitees` (boolean, default false).
- `reminder_at` (timestamp, nullable) and `reminder_sent_at` (timestamp, nullable).
- `ai_summary_json` (text, nullable), `ai_summary_at` (timestamp, nullable), `ai_summary_response_count` (integer, nullable).
- Unique index on `event_id` (SQLite allows multiple NULLs, so general surveys are unaffected).
- `status` stays `draft | running | closed`. A running survey past `closes_at` is treated as closed everywhere, so no cron is needed for closing.

### 7.2 `survey_questions` (alter)

- `required` (boolean, default false).
- `help` (text, nullable).
- `metric_key` (text, nullable; one of the fixed keys in section 5 step 8, validated in code).
- `options_json` meaning per type: `choice` holds the list of choices; `scale` holds `[lowLabel, highLabel]`. The scale is always 1-5.

### 7.3 `survey_assignments` (alter)

- Drop `response_token_hash` and its index. Delivery is session-based.
- Add `source` (`invited | walk_in`).
- Primary key stays `(survey_id, member_id)`, which blocks double submission. Invited rows are created at send. Walk-in rows are created at submit, already completed.

### 7.4 `survey_responses` (alter)

- Add `source` (`invited | walk_in`) so results can filter to the invited sample.
- Store `submitted_at` truncated to the day (Asia/Manila). Exact timestamps next to `survey_assignments.completed_at` would let anyone with database access match responses to members.

Known limit, stated honestly: answers are anonymous in the product, not cryptographically unlinkable. Someone with raw D1 access could still try to correlate by row order. That is acceptable for a student-org evaluation, and the form copy must not promise more than "your name is not attached to your answers".

### 7.4a `survey_answers` (alter)

- Add `hidden_from_organizers` (boolean, default false). CRS admins still see hidden comments, marked as hidden. Hidden answers are left out of everything an organizer sees, including the word cloud and the response counts for that question.

### 7.5 `survey_templates` (new)

`id`, `name`, `description`, `questions_json` (array of question inputs including `required`, `help`, `metric_key`, `options`), `position` (sort order), `archived_at`, `created_by` (FK `set null`), `created_at`, `updated_at`. The three templates in section 6 are inserted by the migration.

### 7.6 `event_debriefs` (new)

`event_id` (PK, FK to `crs_events`, cascade), `intended`, `happened`, `why`, `change` (all text, nullable, max ~2000 characters each), `updated_by` (FK `set null`), `updated_at`.

## 8. Flows

### 8.1 Admin: set up and send

Entry points: a "Feedback" section on `/portal/admin/data/events/[id]`, and the existing survey list.

1. **Choose a template.** Cards show the name, question count and estimated time. Choosing one creates a draft survey tied to the event and copies the template's questions in.
2. **Edit.** A question editor lets the admin add, remove, reorder and edit questions: prompt, help, type, required, scale labels and choices. Tracked questions show a small tag ("Tracked: Overall"). Editing the prompt keeps the tag. The admin can remove the tag; a hint explains that untracked questions are not compared across events. A running estimate of completion time warns above three minutes (rule of thumb: scale 7s, choice 10s, text 45s).
3. **Send panel.**
   - Eligible attendees: count (attended, minus event staff).
   - Who to invite: Suggested (5.1, default) / Everyone / Custom number.
   - "Other attendees can answer from the event page" (default on).
   - "Share results with organizers" (default on; changeable later).
   - "Also email invitees" (default on when `FEATURE_EMAIL` is on; otherwise hidden).
   - Closes at (default: event end + 72h, or start + 72h when there is no end).
   - "Remind people who haven't answered, 24 hours before closing" (default on).
   - Preview opens the member form read-only.
   - Warn when sending before the event has ended, because people still checking in will not be in the sample.
4. **Send.** One server action:
   - Draws the sample from eligible attendees with `seededSample`, seeded by survey id.
   - Inserts invited assignments.
   - Sets `status=running`, `sent_at` and `closes_at`.
   - Notifies each invitee: "How was <event>?", linking to `/portal/surveys/<id>`.
   - If email is on, queues an email campaign through the narrow feedback-email method (section 4.2). The campaign uses the `survey_invitees` audience rule and the "Feedback requests" category (seeded if missing), so members can opt out of feedback emails without losing the in-portal notice. The body is short, with a button to the same link. If no default sender is configured, the send panel hides the email option and says why.
   - Records an audit entry.
5. **While running:** extend `closes_at`, close now, or send the reminder early. Questions are read-only.

### 8.2 Member: answer

- **Invited:** the notification or email opens `/portal/surveys/<id>`, sign-in if needed, then the form.
- **Walk-in:** on `/portal/calendar/<eventId>`, an attendee who is not staff sees a small "Share feedback" card while the form is open and they have not answered. After answering, it reads "Thanks, feedback sent."
- **Home:** the existing "Surveys" metric card counts the member's open invitations.
- **Form page:** mobile first. Each scale question is one row of five large tap targets with end labels under them. Required questions are marked, and help text sits under the prompt. There is a short anonymity and privacy line, and one submit button. Copy says names are not attached, not that answers "cannot be traced".
- **Eligibility, checked on the server at submit:** the survey is running and not past `closes_at`, and the member is either invited and not completed, or a non-staff attendee with walk-ins allowed and no assignment yet. Required questions must be answered, and values are validated per type. Claim the assignment and write the response together, reusing the existing batch pattern.
- **Closed or ineligible:** a clear message instead of the form.

### 8.3 Reminder

- **Picking up due reminders:** the per-minute cron picks up running surveys where `reminder_at <= now` and `reminder_sent_at` is null.
- **Claiming:** it sets `reminder_sent_at` first, so the claim stays idempotent.
- **Notifications:** it notifies invited, uncompleted members.
- **Email:** if `email_invitees` is set, it queues a reminder campaign to all invitees, with "thanks if you've already answered" wording.
- **Walk-ins** are never reminded.
- **Restructure the scheduled handler** so the reminder job runs whether or not `FEATURE_EMAIL` is on. Today the handler returns at `custom-worker.ts:36` when email is off.
- **Verify notifications in the scheduled context.** `notify()` reads its flag through `getAppConfig()` (`src/server/env.ts:65-70`); confirm that works inside a scheduled run, outside the OpenNext request context.
- **Prod has no cron trigger.** Reminders cannot fire there until one is added. Add it to `wrangler.jsonc` as part of the prod rollout, not now.

## 9. Interpretation view

The results live on `/portal/admin/content/surveys/[id]` and are summarized on the archive event page.

- **Header strip:**
  - Total responses.
  - Invited response rate ("31 of 47 invited, 66%"), with a caution under 30%.
  - Walk-in count.
  - Open until, or closed on.
- **Threshold:** below 3 responses, show "Results appear at 3 responses to protect anonymity" and nothing else.
- **Filter:** All responses / Invited sample only.
- **Scale questions:**
  - A horizontal 100% stacked bar of the 1-5 distribution. Dissatisfied values use warm tones, satisfied values cool tones, and the colours work in both themes.
  - Top-two-box percentage as the headline figure.
  - Mean to one decimal and n as secondary figures.
  - For tracked questions, a context line: "Workshops average 4.2 (12 past events)". It appears only when this survey has at least 5 responses and there are at least 3 past closed surveys of the same event type with that metric.
- **Choice questions:** a horizontal bar of counts, with percentages.
- **Text questions:**
  - A comment list with a search box.
  - Above it, a word cloud: the top ~30 terms sized by frequency, with English plus common Filipino/Taglish stopwords removed (ang, ng, sa, na, mga, yung, po, lang, naman, kasi, talaga, and so on).
  - Clicking a word filters the comments to those that contain it. That turns the cloud into a navigation aid rather than decoration.
- **Comment summary (AI):** a collapsed `<details>` labelled "Summary of comments". It never opens by default and never appears in lists. See section 10.

All charts are hand-built SVG/CSS, following `retention-charts.tsx`. User-controlled text (comments, prompts, event titles) uses `min-w-0` and `break-all` per the project's mobile overflow rule.

## 10. AI comment summary

- **Trigger:** a "Draft a summary" button inside the collapsed panel. It is never automatic.
- **Engine:** Workers AI through an `AI` binding added to the wrangler configs and `cloudflare-env.d.ts`. The builder picks a current instruct model that supports JSON output. When the binding is absent (local dev, tests, an environment without it), the panel is hidden entirely.
- **Input:**
  - The text answers for this survey, grouped by question.
  - Capped at about 12,000 characters. If there is more, take an evenly spaced subset and say so.
  - Never any member identifiers (there are none to send).
- **Output contract (JSON):** 3-6 themes, each with a short label, a one-sentence description, a rough share ("several", "most", "a few"), and 1-2 verbatim quotes.
- **Validation:** keep a theme only if every quote is a case-insensitive substring of an actual answer. Drop themes that fail. If nothing survives, show "Couldn't draft a reliable summary".
- **Storage:** result JSON, generation time and response count go on the survey row. When the response count has grown since generation, show "Drafted from 18 of 26 comments" with a Regenerate button.
- **Tone in the UI:** plain list, small type, footnote "Machine-drafted from N comments on <date>. Read the comments before acting on it." No sparkles icon, no "AI insights" heading.
- **Permissions:** generating and viewing the summary is limited to `survey:configure` holders. Organizers do not see this panel.

## 11. Event archive

- **List (`/portal/admin/data/events`):**
  - Adds columns for overall top-two-box (or mean), responses, invited response rate, and a debrief-written marker.
  - Adds a filter for event type, next to the existing term filter and search.
  - Past events sort newest first.
  - The nav label for this page may become "Event archive"; that is the builder's call.
- **Detail (`/portal/admin/data/events/[id]`)** gains two sections above the roster:
  - **Feedback:** a compact summary (tracked metrics with distributions, response rate), a link to the full results, or the set-up-and-send flow when no form exists.
  - **Debrief:** the four After Action Review fields, editable by CRS admins and the event's staff admins, showing the last editor and date.
- **Planning hook:** the event creation and edit form shows a small link, "See feedback from past <type> events", to the archive filtered by type. It is visible only to people who can view the archive.

### 11.1 Organizer view

This lives on the member event page, `/portal/calendar/[eventId]`, next to the existing staff tools. Admin pages stay admin-only, because `src/app/portal/admin/layout.tsx` blocks non-admins.

- **Who sees it:** the owner and staff admins of that event, and only when the form has closed or has at least 3 responses, and `share_with_organizers` is on.
- **What it shows:**
  - The same results components as the admin view, minus the AI panel and minus comments hidden from organizers.
  - Response rate, distributions, cross-event context lines, and the word cloud and comment list.
- **Debrief:** the four After Action Review fields are editable here by the owner and staff admins.
- **When sharing is off:** the panel shows "Feedback for this event is not shared with organizers". The debrief stays editable.
- **Reuse:** build the results components once and use them in both places, with a prop for what the organizer must not see.

## 12. Permissions and visibility

| Who | Can |
|---|---|
| `retention` role (CRS) and `super` | Manage templates. Create, edit and send forms for any event. View all results and the archive. Generate summaries. Edit any debrief. |
| Organizers (event owner, plus `event_staff` with staff role `admin`) | On their own event's page only: view results when shared (minus hidden comments and the AI summary), and edit the debrief. |
| `survey:configure` holders, additionally | Toggle "Share results with organizers" and hide or unhide individual comments from organizers. |
| Attendee (non-staff) | Answer while open: invited, or walk-in when allowed. |
| Everyone else | Nothing. |

- Grant `survey:configure` to `retention` in `rolePermissions`.
- Organizer access is an explicit check against `crs_events.created_by` and `event_staff`, not a new role.
- Archive pages currently gate on `retention:record`. Keep that for the roster, and use `survey:configure` or event-staff-admin for the feedback and debrief sections.

## 13. Environments, flags, migrations, tests

- **Feature flag:** reuse `FEATURE_SURVEYS`. It stays on for beta and off for staged and prod until OSG signs off. Notifications need `FEATURE_NOTIFICATIONS`; email needs `FEATURE_EMAIL`. Each path degrades quietly when its flag is off.
- **Shared dev Worker:** surveys have no shared-dev proxy, only the server-side handler `src/server/internal/surveys.ts` behind `/internal/surveys` and the contract in `src/db/contract/surveys.ts`. Keep the handler and contract in sync with every changed repository method. Do not build a proxy. Then run `pnpm db:migrate:dev` and `pnpm deploy:dev`, per CLAUDE.md.
- **Remove the token submit path:** delete `src/app/api/surveys/submit/route.ts` (and its test) and the contract op `submit` (`auth: "public"`). The member page's server action, checked against the session, replaces them.
- **Migration:** `0012`.
  - Dropping the token column means drizzle rebuilds the `survey_assignments` table; check the generated SQL.
  - Before applying to beta D1, run a read-only count of existing `surveys` rows. Show the exact `pnpm exec wrangler` command and wait for approval, as with every D1 operation.
  - Any existing beta survey rows are test data. Existing assignments can carry `source='invited'`.
- **Seed:** update `src/db/seed/data.ts` with one event that has a sent feedback form, about 8 responses (with spread), and one debrief, so the results view can be checked locally.
- **Tests:** everything runs in the Workers Vitest pool. That means `.ts` only, no jsdom, no render tests, and no better-sqlite3 import. Cover:
  - Pure functions: sample-size suggestion, distribution / top-two-box / mean, word frequency with stopwords, AI quote validator, completion-time estimate.
  - Repository integration:
    - Sampling draws only non-staff attendees.
    - Walk-in eligibility.
    - Double-submit rejection.
    - Submit after `closes_at` rejected.
    - The response threshold.
    - The comparison baseline query.
    - Reminder idempotency.
    - Questions frozen after send.
- **Workers AI** is not called in tests. Pass the summarizer a fake.

## 14. Questions to take to OSG

These do not block building on beta, but OSG should confirm them before prod.

1. Are they comfortable dropping "no form, no points" now that check-in awards points?
2. Anonymous answers, or do they need to follow up with specific people?
3. Organizers see their own event's feedback by default, and CRS can switch that off per form or hide single comments. Is that the right default, or should it start off?
4. Should planners who are not CRS admins be able to browse the archive?
5. Is a 72-hour window acceptable, versus their current same-day rule?

## 15. Left to the builder

- Component structure, file names, and whether the question editor is shared between drafts and templates (it should be).
- The exact Workers AI model and prompt wording, within section 10's contract.
- The stopword list contents.
- Colour tokens for the diverging bar, within the existing theme.
- Whether the archive nav label changes.
- Pagination and limits on the comment list.
- Deliberately skipped: per-member survey-fatigue throttling. It would bias samples against frequent attendees. Revisit if members complain about volume.
