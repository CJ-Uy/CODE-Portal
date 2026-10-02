# Email System — Design

Date: 2026-10-02
Status: approved in conversation, awaiting written-spec review
Scope: Project A of two. Project B (portal-wide UI and motion overhaul) gets its own spec after this ships to beta.

## 1. Intent

Give CODE an internal email channel that email admins run from the portal. Admins send bulk or targeted emails to members using reusable, CODE-branded templates. Member replies come back into a shared inbox in the portal. Members can read past CODE emails in the portal and opt out of optional categories. Required categories (announcements, memos) cannot be opted out of.

Success:

- An email admin can build a template, pick an audience, send a test to themselves, and send or schedule the real email without leaving the portal.
- A 300-member send completes without manual babysitting, within Cloudflare's daily quota, and every recipient's outcome is visible.
- A member's reply shows up in the portal inbox, threaded to the send it answers.
- A member can opt out of an optional category in one click from the email, and can never opt out of a required one.

Out of scope for v1: open and click tracking, A/B tests, external (non-member) recipients, attachments on outbound mail, approval workflows, nested audience filter groups, raw HTML authoring.

## 2. Constraints

- Cloudflare Email Service. Sending uses the Workers `send_email` binding. Inbound uses Email Routing to a Worker.
- Workers Paid plan on account `83376df5e0bae067afa197b07430168d`. 3,000 emails per month are included, then $0.35 per 1,000. The account starts with a conservative daily quota that grows with reputation.
- At most 50 addresses across to/cc/bcc per send. Merge tags need one send per recipient.
- `ateneocode.org` is onboarded as a sending domain by the user in the dashboard. Email Routing is enabled on the same zone.
- All tests run in the Workers vitest pool: `.ts` only, no jsdom, no render tests.
- Drizzle schema in `src/db/schema.ts` is the only schema source. One migration on the trunk `drizzle/migrations` lineage.
- Ship behind a new feature flag `FEATURE_EMAIL`, on for beta only.

## 3. Roles and permissions

- New role key `email` in `roleKeys`, seeded into `roles` by the migration (label "Email", kind matching existing scoped roles).
- New permission actions:
  - `email:send`: compose, test-send, send, schedule, cancel, view reports, use the inbox.
  - `email:configure`: manage templates, categories, and sender identities.
- `rolePermissions.email = ["email:send", "email:configure"]`. `super` inherits both through `can()`.
- Every server action and route handler checks the permission and the feature flag server-side. Hidden UI is not authorization.
- New audit category `email`. Every create, update, archive, send, schedule, cancel, retry, test-send, inbox reply, inbox archive, and assignment writes an audit row.

## 4. Data model

All IDs follow the existing `src/lib/ids.ts` convention. Timestamps are `timestamp_ms` integers.

### `email_categories`
| column | notes |
|---|---|
| id | PK |
| name | unique among non-archived |
| description | shown to members on the preferences page |
| required | boolean. Required categories ignore opt-outs and carry no unsubscribe header |
| default_sender_id | FK `email_senders`, nullable |
| sort_order | integer |
| archived_at | nullable. Categories with sends are archived, never deleted |

### `email_senders`
| column | notes |
|---|---|
| id | PK |
| address | must end in `@ateneocode.org`, unique |
| display_name | e.g. "CODE Events" |
| archived_at | nullable |

### `email_templates`
| column | notes |
|---|---|
| id | PK |
| name | |
| category_id | FK, default category for sends started from this template |
| subject, preheader | may contain merge tags |
| blocks | JSON array of blocks (section 6) |
| created_by, updated_by | FK members |
| created_at, updated_at, archived_at | |

### `email_campaigns`
One row per send, bulk or targeted.

| column | notes |
|---|---|
| id | PK |
| template_id | FK, nullable (sends can start blank) |
| category_id, sender_id | FK, required before scheduling |
| subject, preheader, blocks | snapshot. Editing a template never changes a sent campaign |
| audience | JSON rule (section 7) |
| status | `draft` / `scheduled` / `sending` / `sent` / `cancelled` / `failed` |
| scheduled_at | when to dispatch. "Send now" sets it to now + 2 minutes (undo window) |
| started_at, finished_at | |
| recipient_count, sent_count, failed_count, skipped_count | denormalized for list views |
| created_by | FK members |
| created_at, updated_at | |

Index on `(status, scheduled_at)`.

### `email_deliveries`
The outbox. One row per resolved recipient.

| column | notes |
|---|---|
| id | PK |
| campaign_id | FK cascade |
| member_id | FK set null |
| email | snapshot of the address at dispatch |
| status | `pending` / `sent` / `failed` / `skipped_optout` / `skipped_no_email` / `cancelled` |
| attempts | integer |
| next_attempt_at | nullable |
| message_id | Message-ID returned or set at send, used for reply threading |
| error | last error text |
| sent_at | |
| read_at | nullable, set when the member opens the reading view in `/portal/mail` |

Unique index on `(campaign_id, member_id)`. Index on `(status, next_attempt_at)`. Index on `message_id`.

### `email_optouts`
PK `(member_id, category_id)`, plus `created_at`. Only meaningful for optional categories.

### `email_threads`
| column | notes |
|---|---|
| id | PK |
| campaign_id | FK nullable, set when the first message threads to a send |
| member_id | FK nullable, set when the sender address matches a member |
| from_email, from_name | |
| subject | |
| status | `open` / `done` |
| assignee_id | FK members, nullable |
| unread | boolean for the shared inbox |
| is_auto | boolean, true for auto-replies |
| last_message_at | |

Index on `(status, last_message_at)`.

### `email_messages`
| column | notes |
|---|---|
| id | PK |
| thread_id | FK cascade |
| direction | `in` / `out` |
| message_id, in_reply_to, references | header values |
| from_email, to_email, subject | |
| text | plain text body |
| html | sanitized HTML, nullable |
| raw_key | R2 key of the raw `.eml` for inbound mail |
| sent_by | FK members, for `out` messages |
| created_at | |

Index on `message_id`.

## 5. Runtime architecture

### Custom Worker entry
The app has no custom Worker entry today. Add `src/worker.ts` that re-exports the OpenNext `fetch` handler from `.open-next/worker.js` and adds:

- `scheduled(controller, env, ctx)`: runs the email dispatcher.
- `email(message, env, ctx)`: runs the inbound handler.

All three wrangler configs point `main` at the built entry. Each config gets:

- `send_email: [{ name: "EMAIL", allowed_sender_addresses: [...] }]`, with addresses listed per env or a domain restriction where supported.
- `triggers.crons: ["* * * * *"]`.
- vars `FEATURE_EMAIL`, `EMAIL_INBOX_ADDRESS`, `EMAIL_BATCH_PER_TICK` (default 25), `EMAIL_DAILY_CAP` (default 300).
- secret `EMAIL_UNSUBSCRIBE_SECRET`.

Beta uses `beta-inbox@ateneocode.org`; prod later uses `inbox@ateneocode.org`. Email Routing rules point each address at its own Worker.

Run `pnpm cf-typegen:dev` after the binding change.

### Sender interface
`src/server/email/sender.ts` exposes `type EmailSender = { send(msg): Promise<{ messageId: string }> }`. Production wraps `env.EMAIL.send`. Tests inject a fake. This is the only seam; it exists because tests cannot call the real binding.

### Dispatcher (cron, every minute)
1. **Claim due campaigns.** `UPDATE email_campaigns SET status='sending', started_at=now WHERE status='scheduled' AND scheduled_at<=now` per row, checking the changed-row count. Only the tick that flips the row resolves the audience.
2. **Resolve audience** for each newly claimed campaign (section 7) and insert delivery rows in chunks. Opted-out members of optional categories become `skipped_optout`. Members without an email become `skipped_no_email`. `INSERT … ON CONFLICT DO NOTHING` on `(campaign_id, member_id)`.
3. **Drain.** Select up to `EMAIL_BATCH_PER_TICK` rows with `status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=now)`, oldest campaign first. Stop early if today's sent count (Asia/Manila day) reached `EMAIL_DAILY_CAP`.
4. For each row: render subject, preheader, HTML, and text with that member's merge values. Send with headers (section 8). On success set `sent`, `message_id`, `sent_at`. On failure increment `attempts`, store `error`, and set `next_attempt_at` to now + 1, 5, then 15 minutes; after 3 attempts set `failed`. A quota or rate-limit error stops the drain for this tick without spending an attempt.
5. **Finish.** A `sending` campaign with no `pending` rows gets `finished_at`, then status `sent` (or `failed` if zero rows were sent). Update the denormalized counts.

The dispatcher is a plain function `runEmailDispatch(db, sender, now, config)` so tests call it directly.

### Test send
A server action renders the campaign or template as a chosen member ("preview as") and sends one email straight through `EmailSender` to the actor's own address. Subject is prefixed `[Test]`. Not counted in campaign counts. Audited.

### Cancel and retry
- Cancel: allowed for `scheduled` (status → `cancelled`) and `sending` (pending rows → `cancelled`, campaign → `cancelled`). Uses the same conditional-update pattern.
- Retry failed: resets `failed` rows of a finished campaign to `pending` with `attempts=0` and puts the campaign back to `sending`.

## 6. Templates and rendering

### Blocks
A block is `{ id, type, props }`. Types and props:

| type | props |
|---|---|
| heading | `text`, `level` (1 or 2) |
| text | `text` (limited inline marks: bold, italic, link) |
| button | `label`, `href` |
| image | `src` (R2 upload through the existing storage proxy), `alt`, `href?` |
| divider | none |
| spacer | `size` (sm, md, lg) |
| event | `eventId` — renders title, date, location, and a link from the live event at send time, then snapshots into the campaign |

The brand header (logo) and footer (org name, "Sent to you because: <category>", preferences link, unsubscribe link for optional categories) are fixed and not blocks. Colors and fonts come from the CODE palette only; there is no free color picker.

Blocks are validated with zod on every save and on send.

### Renderer
`src/server/email/render.ts` turns blocks into table-based, inline-styled HTML that Gmail and Outlook render, plus a plain-text alternative. It is a pure function with no React, so the Workers pool can unit-test it.

### Merge tags
Syntax `{{first_name}}`. Allowed tags: `first_name`, `full_name`, `nickname`, `batch`, `email`. Unknown tags are rejected at save. Values are HTML-escaped. `first_name` falls back to nickname, then "there".

## 7. Audiences

`audience` JSON:

```ts
type Audience = {
  match: "all" | "any";
  include: AudienceRule[];
  exclude: AudienceRule[];
};
type AudienceRule =
  | { kind: "roster"; termId: "current" | string }
  | { kind: "role"; roleKey: RoleKey }
  | { kind: "batch"; batch: string }
  | { kind: "status"; status: MemberStatus }
  | { kind: "event"; eventId: string; relation: "rsvp" | "attended" | "no_show" }
  | { kind: "member"; memberId: string };
```

`member` rules always union in, regardless of `match`. `exclude` always subtracts. The resolver returns a deduplicated member list. A preview endpoint returns counts for the composer card: matched, will receive, opted out, no email, plus the first names in each group on demand.

## 8. Headers and unsubscribe

Every email:

- `From: <sender display_name> <sender address>`
- `Reply-To: <EMAIL_INBOX_ADDRESS>`
- A `Message-ID` we generate (`<deliveryId@ateneocode.org>`) so threading does not depend on the provider's response.

Optional categories also get:

- `List-Unsubscribe: <https://<host>/unsubscribe?t=<token>>`
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

The token is `base64url(memberId.categoryId).HMAC-SHA256(secret)`. `POST /unsubscribe` with a valid token records the opt-out (one-click, RFC 8058). `GET /unsubscribe` with a valid token records the opt-out and renders the landing card with Undo. Tokens for required categories are rejected. `unsubscribe` is added to `RESERVED_SLUG_DEFAULTS` so a short link cannot shadow it.

## 9. Inbound

The `email` handler:

1. Reject messages over 5 MB with `setReject`.
2. Store the raw message in R2 under `email/inbound/<yyyy>/<mm>/<id>.eml`.
3. Parse with `postal-mime` (new dependency, Workers-native).
4. Thread: look up `In-Reply-To`, then each `References` id, against `email_deliveries.message_id` and `email_messages.message_id`. If one matches a delivery, the thread links to that campaign. If one matches a message, append to its thread. Otherwise start a new thread.
5. Match `from` against `members.email` (lowercased).
6. Sanitize HTML with the Workers-native `HTMLRewriter`: allowlist of tags and attributes, strip scripts, styles with `url()`, event handlers, and forms. Remote images stay as links; they are not loaded by default.
7. Flag auto-replies (`Auto-Submitted` other than `no`, `Precedence: bulk|auto_reply`, `X-Autoreply`). Store them, mark the thread `is_auto`, and do not mark it unread.
8. Set the thread unread and `open`, update `last_message_at`.

Inbox replies send through `EmailSender` from the campaign's sender (or a chosen sender) with `In-Reply-To` and `References` set, then store an `out` message.

The inbox renders inbound HTML in a sandboxed `<iframe srcdoc sandbox="">` with no scripts.

## 10. Screens

Admin pages are a new **Email** group in `src/app/portal/admin/nav.ts`, gated by `feature: "email"` and the permissions above. Member pages live under `/portal/mail`.

| Route | Permission | Screen |
|---|---|---|
| `/portal/admin/email` | `email:send` | Home. "Sending now" (only while a send runs; live sentence plus progress bar), Scheduled, Recent sends (5), Drafts. Right rail: quota line ("312 of 3,000 this month, resets Nov 1"), today's sends vs `EMAIL_DAILY_CAP`, template shortcuts. |
| `/portal/admin/email/new`, `/portal/admin/email/sends/[id]/edit` | `email:send` | Composer. One page, checklist sections: Sender & category, Audience, Subject & preview text, Content, Timing. Each collapsed section shows a check and a one-line summary. A sticky right column holds the live preview, recipient count chip, "Send test", and "Review & send". The review modal restates sender, category, audience summary, count, and timing. The primary button reads "Send to 214 members" or "Schedule for Oct 5, 9:00 AM". |
| (composer) | | Audience. Token field that mixes groups and people. Match all/any toggle. Exclude field, collapsed by default. Count card: "214 will receive", then "of 240 matched · 18 opted out of Newsletters · 8 no email", each line expandable. |
| `/portal/admin/email/templates` | `email:configure` | Library. Search, sort, grid of real-render thumbnails with "Updated 2d ago · used 6×" and a menu (Duplicate, Archive). Blank card first. |
| `/portal/admin/email/templates/[id]` | `email:configure` | Builder. Palette (220px), canvas at 600px with Desktop/Mobile toggle (600 / 375), undo/redo, inspector (300px). Merge tags show as pills; `{` or `/` opens the tag menu. Preview-as-member picker. Drag to reorder plus up/down buttons. Composer content uses the same builder inline. |
| `/portal/admin/email/sends/[id]` | `email:send` | Report. Header (subject, sender, category, "Sent by X · date"). Count strip Queued / Sent / Failed / Skipped, each a filter. One stacked bar. Tabs: Recipients (searchable, status filter, "Retry failed") and Content. Actions: Duplicate, Cancel while scheduled or sending. |
| `/portal/admin/email/inbox`, `/portal/admin/email/inbox/[threadId]` | `email:send` | Inbox. Folders Open / Done, filters Mine / Unassigned. Unread rows bold with a dot; campaign chip under the subject. Thread header: assignee, Done, campaign link. Reply composer at the bottom. Done shows an undo toast. |
| `/portal/admin/email/settings` | `email:configure` | Senders card and Categories card. Category rows show "Required" with a lock or "Optional", default sender, reorder. Edits open a side sheet. Archive, never delete, once a row has history. "Preview member page" link. |
| `/portal/mail` | signed-in member | Archive of campaigns the member received (delivery status `sent`). Unread dot, subject, category chip, date. |
| `/portal/mail/[id]` | recipient only | Reading view, 680px max. Renders the snapshot with the member's merge values. Footer: "Sent to you because: <category> · Manage". |
| `/portal/mail/preferences` | signed-in member | Required group first: switch locked on, lock icon, one-line reason. Optional group: switches that autosave with a toast. |
| `/unsubscribe?t=` | public | 420px card: "You're unsubscribed from Newsletters." Undo button, "Manage all preferences" link, note listing required categories that still arrive. No retention prompts. |

Member read state uses `email_deliveries.read_at`.

### Mobile
- Composer sections stack. A sticky bottom bar holds the count and primary button. Preview opens in a sheet.
- Builder becomes a block list with up/down/delete and "+ Add block" opening a bottom sheet. No drag on touch.
- Audience token field opens a full-screen search sheet.
- Report count strip becomes 2×2.
- Inbox list is full screen; a row pushes the thread.

### Motion
- Progress bar width animates (200ms ease-out) on each 3-second poll while a send runs. Counts tick. No spinners.
- "Review & send" button morphs to a check (150ms), then routes to the report.
- Every reversible action (Done, archive, opt-out) gets an undo toast.
- Archived rows collapse (150–200ms). New rows fade in.
- Drag lifts the block (shadow, 1.02 scale), shows a 2px navy drop line, and siblings shift with a 150ms transform.
- Skeletons for lists and the count strip. The count chip shows a muted "…" while the 300ms debounce recalculates.
- All motion respects `prefers-reduced-motion` and falls back to instant changes.

### Copy
Plain CODE voice. No open-rate or click metrics in v1. No promotional or cute copy.

## 11. Error handling

- A failed delivery keeps its error text and is retryable from the report.
- A quota or rate-limit response pauses the drain until the next tick without spending an attempt.
- A campaign with zero sent rows after all attempts ends `failed`.
- A missing or archived sender or category blocks scheduling with an inline error in the composer.
- Inbound parse failures still store the raw `.eml` and create a thread with the subject "(could not parse message)" so nothing is lost.
- Invalid or forged unsubscribe tokens render a neutral "This link is not valid" card with a sign-in link to preferences.

## 12. Security

- Recipients come only from member and roster resolution. There is no free-text external address field, so the system cannot relay to arbitrary addresses. Inbox replies go only to the thread's `from_email`.
- Sender must be an active `email_senders` row on `@ateneocode.org`. The binding's allowed-sender list enforces the same rule at the platform level.
- Merge values are escaped. Blocks go through the fixed renderer. Raw HTML is never accepted from admins.
- Inbound HTML is sanitized on store and rendered in a sandboxed iframe.
- Unsubscribe tokens are HMAC-signed, scoped to one member and one category, and rejected for required categories.
- Double dispatch is prevented by the conditional status update and the delivery unique index.
- Members can read only campaigns they have a `sent` delivery for.

## 13. Testing

Workers vitest pool, `.ts` only.

Unit:
- Block schema validation and renderer output (HTML contains escaped merge values, text alternative present, footer varies by required/optional).
- Merge tag parsing, unknown-tag rejection, fallbacks.
- Audience resolver: all/any, member union, exclude, dedupe, opted-out and no-email splits.
- Unsubscribe token sign/verify, tamper rejection, required-category rejection.
- Backoff schedule and quota-error handling.
- Inbound threading by `In-Reply-To` and `References`, auto-reply detection, sanitizer allowlist.

Integration (D1):
- Two concurrent dispatch ticks claim a campaign once and never double-send a delivery.
- Opted-out member is skipped for an optional category and still sent for a required one.
- Cancel while sending stops pending rows.
- Retry failed resets only failed rows.
- Permission gates on every action: member without `email` role is refused; `super` is allowed.
- Member archive returns only campaigns with a `sent` delivery for that member.

Manual on beta:
- Real test send to self; Gmail desktop and phone rendering.
- Real send to a small audience; report progress updates.
- Reply from Gmail lands in the inbox threaded to the send.
- One-click unsubscribe from Gmail's header and from the footer link.

## 14. Rollout

1. User onboards `ateneocode.org` in Email Service and enables Email Routing; adds the `beta-inbox@` rule to `code-nest-beta`.
2. Set `EMAIL_UNSUBSCRIBE_SECRET` on beta with `wrangler secret put`.
3. Migration applied to `code-nest-beta-db` (command shown and approved first, per CLAUDE.md).
4. `pnpm deploy:dev`.
5. Grant the `email` role to the first email admin in Roles & Access.
6. Seed categories (Announcements and Memos required; Newsletter and Events optional) and one sender from the settings screen.
7. Run the manual beta checks, then iterate on beta.

Staging and prod stay untouched; `FEATURE_EMAIL` stays off there until a separate release decision.

## 15. Dependencies

- `postal-mime` (inbound parsing). No other new dependencies:
  - Rendering is a hand-written pure function.
  - Sanitizing uses the Workers-native `HTMLRewriter`.
  - Drag reorder uses native HTML drag events on desktop; up/down buttons are the keyboard and touch path. No sortable library is installed and none is added.
  - Motion uses CSS transitions and the View Transitions API where supported. No animation library is added.

## 16. Planning amendments (2026-10-02)

Found while writing the implementation plan. These override the sections above.

- **Threading key.** Cloudflare Email Service does not let us set `Message-ID`, because the platform controls it. Replies are threaded by a plus-addressed `Reply-To` instead: `beta-inbox+edl_<deliveryId>@` for sends and `beta-inbox+eth_<threadId>@` for inbox replies. Subaddressing must be on in Email Routing settings. Matching `In-Reply-To` and `References` against stored inbound Message-IDs remains as the fallback.
- **`skipped_no_email` removed.** `members.email` is `NOT NULL`, so this status can never happen.
- **Footer unsubscribe link opens a confirm page.** Link scanners prefetch GET URLs, so a GET request never writes an opt-out. The `List-Unsubscribe` header still uses RFC 8058 one-click POST, which Gmail and Yahoo show as a native button.
- **Cancel split in two.** `unschedule` sends a scheduled campaign back to draft, which also serves as the 2-minute undo. `cancel` stops a campaign that is sending.
- **Image blocks take an HTTPS URL.** Uploading images is outside v1.
- **Composer preview.** The block canvas in the Content step is the live preview, with Desktop/Phone and "preview as" controls. The sticky right column holds the summary, the test send, and Review and send.
- **Inactive members** are left out of audiences unless an explicit `status: inactive` rule includes them or they are picked by hand.
- **Beta only.** Only `wrangler.beta.jsonc` points at the custom Worker entry. Staging and prod configs are not touched.
