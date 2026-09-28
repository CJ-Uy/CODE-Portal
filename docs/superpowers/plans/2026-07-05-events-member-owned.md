# Events & Attendance — Member-Owned Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). Steps use `- [ ]` checkboxes.
> **Source spec:** [`2026-07-04-events-attendance-system-design.md`](../specs/2026-07-04-events-attendance-system-design.md) — read §11 (adversarial-review resolutions) before starting.

**Goal:** Flip the admin-only events system to member-owned (any member creates → instant publish), with per-event roles, a fixed check-in window, retroactive CRS point control, and invites.

**Architecture:** Reads = server components calling `getRepositories()` directly with an `actor` from `requireActor()`. Writes = colocated `"use server"` `actions.ts` → `repositories.events.<op>(actor, input)` → `revalidatePath`. The internal contract (`src/db/contract/events.ts`) + shared-dev worker (`src/server/internal/events.ts`) mirror every op. Points stay materialized in `retention_records`; a single UPDATE re-values them so all `SUM(points)` read paths are untouched.

**Tech Stack:** Next.js (App Router, RSC + server actions), Drizzle + Cloudflare D1, Zod contract ops, shadcn/ui, Auth.js v5.

## Work split
- **[CODEX]** — Phases B1–B4 (schema, migrations, contract, repos, permissions, shared-dev, tests). Codex is fast + reliable on backend; hand it these to save Claude tokens.
- **[UI]** — Phases U1–U3 (Claude builds these; Codex is weak at UI). Built against the contract signatures in "Shared Seam" below so both sides integrate cleanly.

## Global Constraints (verbatim from CLAUDE.md + spec)
- Drizzle schema `src/db/schema.ts` is the ONLY schema source. Never expose D1 as `DATABASE_URL`. No raw-SQL internal endpoints.
- After schema/migration/contract/permission changes: update dev Worker — `pnpm db:migrate:dev` then `pnpm deploy:dev`. **Show exact `pnpm exec wrangler` command and WAIT for approval** before any D1 reset/migrate/seed/delete/prod op.
- Every new **write** contract op MUST set `sharedDev: "deny"`; only reads may `allow`.
- `null` points = "unset — attendance only, worth nothing yet"; `0` = "explicit zero". Suppress "worth N points" notification when null.
- Owner = `crsEvents.createdBy`; NO owner row in `event_staff`.
- `retention_records.event_id` already exists (`schema.ts:312`, index :324) — do not re-add.

---

## Shared Seam — contract signatures (both sides code to this)

Event output gains three viewer-scoped fields the UI keys off (backend computes per `actor`):
```ts
// added to eventOutputSchema
myRole:      z.enum(["owner", "admin", "scanner"]).nullable(), // event_staff/createdBy resolution for actor
canModerate: z.boolean(), // actor has event:moderate (CRS admin)
canSetPoints:z.boolean(), // actor has event:points (CRS admin)
deletedAt:   z.coerce.date().nullable(),
// status stays in schema but is no longer read for visibility
```
New/changed ops on `eventsContract`:
| Op | auth | permission | sharedDev | notes |
|---|---|---|---|---|
| `create` | member | — | deny | `endsAt` required (`z.coerce.date()`, no `.nullable`); writes `status:"approved"` (belt) |
| `listPublished` (rename `listApproved`) | member | — | allow | `WHERE deleted_at IS NULL`, no status filter |
| `update` ✨ | member | — | deny | owner/admin-staff or `event:moderate`; patch title/desc/place/time/capacity/type |
| `delete` ✨ | member | — | deny | owner or `event:moderate`; **soft-delete** (`deletedAt`) |
| `setPoints` ✨ | admin | `event:points` | deny | tx: update event + re-value retention; batch-notify; null→no notify |
| `addStaff` / `removeStaff` ✨ | member | — | deny | owner/admin; role `"admin"|"scanner"` |
| `transferOwnership` ✨ | member | — | deny | owner only; tx: set `createdBy` + demote old owner → `admin` staff row |
| `invite` / `listInvites` ✨ | member | — | deny / allow | owner/admin; invite = insert-on-conflict-nothing + notify new only |
| `scan` | member | — | deny | event-staff on event OR `event:moderate`; window check; tx attendance+retention @ current points; NO points notify |
| `searchMembers` | member | — | allow | owner/admin broad search; plain scanner = exact id/QR only |
| `listAttendance` | member | — | allow | event-staff or `event:moderate` |
| `approve`/`reject` | — | — | — | **delete these ops** |

Repository method signatures (`EventsRepository`, `src/db/repositories/events.ts`):
```ts
resolveCapability(actor: Actor, event: {createdBy: string; id: string}): Promise<"owner"|"admin"|"scanner"|null>;
create(actor, input): Promise<EventRecord>;              // no permission gate
listPublished(actor, input?): Promise<EventRecord[]>;    // deletedAt IS NULL
update(actor, eventId, patch): Promise<EventRecord>;
softDelete(actor, eventId): Promise<void>;
setPoints(actor, eventId, points: number|null): Promise<{ updated: number }>;
addStaff(actor, eventId, memberId, role: "admin"|"scanner"): Promise<void>;
removeStaff(actor, eventId, memberId): Promise<void>;
transferOwnership(actor, eventId, toMemberId): Promise<void>;
invite(actor, eventId, memberIds: string[]): Promise<{ invited: number }>;
listInvites(actor, eventId): Promise<Array<{ memberId: string; fullName: string|null; invitedAt: Date }>>;
recordScan(actor, input): Promise<RecordScanResult>;     // window + staff enforced
```
`CHECKIN_LEAD_MS = 30 * 60 * 1000`. Window = `[startsAt - CHECKIN_LEAD_MS, endsAt]`. Override actors (owner/admin/`event:moderate`) bypass window.

---

## Phase B1 — Schema & migrations [CODEX]

**Files:** Modify `src/db/schema.ts`; new migration in `drizzle/` (via `pnpm drizzle-kit generate`); seed `src/db/seed/data.ts`.

**Interfaces — Produces:** `eventStaff`, `eventInvites` tables; `crsEvents.deletedAt`; `crsEvents.endsAt` NOT NULL (gated).

- [ ] **B1.1** Add `eventStaff` table: `eventId text FK crs_events(id) on delete cascade`, `memberId text FK members(id) on delete cascade`, `role text ('admin'|'scanner')`, `addedBy text FK members(id) on delete set null`, `addedAt int default now`, PK `(eventId, memberId)`, index `(memberId)`.
- [ ] **B1.2** Add `eventInvites` table: `eventId`, `memberId` (FKs cascade), `invitedBy text FK members set null`, `invitedAt int default now`, PK `(eventId, memberId)`, index `(memberId, invitedAt)`.
- [ ] **B1.3** Add `crsEvents.deletedAt int` (nullable, ms).
- [ ] **B1.4** `pnpm drizzle-kit generate` → review SQL → **show `pnpm exec wrangler d1` command, WAIT for approval**, then `pnpm db:migrate:dev`.
- [ ] **B1.5** `endsAt` NOT NULL: **separate gated step.** Produce an audited list of existing null `ends_at` rows (`SELECT id, title, starts_at FROM crs_events WHERE ends_at IS NULL`), set per-row sane ends (validate `ends_at > starts_at`), THEN alter to NOT NULL. Do not blind `+3h`. Show command, wait for approval.
- [ ] **B1.6** Commit.

**Acceptance:** `pnpm db:studio` (dev) shows both tables + `deletedAt`; no null `ends_at` after B1.5.

## Phase B2 — Permissions & roles [CODEX]

**Files:** Modify `src/server/auth/permissions.ts`; seed `src/db/seed/data.ts`; `src/server/auth/permissions.test.ts`.

- [ ] **B2.1** Add `"event:moderate"`, `"event:points"` to `permissionActions`. Remove dead `"event:approve"` (or leave; retire from role sets).
- [ ] **B2.2** `roleKeys`: replace `"calendar"` with `"events"`. Add `calendar: "events"` to `roleKeyAliases` (like `crs: "retention"`) so old rows/sessions resolve.
- [ ] **B2.3** `rolePermissions`: drop `calendar`; add `events: ["event:moderate", "event:points"]`. Remove `"event:approve"` from `retention` (keep `points:assign`, `retention:record`).
- [ ] **B2.4** Data migration: `UPDATE roles/member_roles SET role_key='events' WHERE role_key='calendar'` (gated wrangler command, wait approval).
- [ ] **B2.5** Update `permissions.test.ts`: `events` role → both perms; `calendar` alias → `events`; retention no longer has `event:approve`. Run `pnpm test permissions`.
- [ ] **B2.6** Commit.

**Acceptance:** `pnpm test permissions` green; `normalizeRoleKey("calendar") === "events"`.

## Phase B3 — Contract + repositories [CODEX]

**Files:** Modify `src/db/contract/events.ts`, `src/db/repositories/events.ts`, `src/server/internal/events.ts`, `src/db/repositories/events.integration.test.ts`.

**Interfaces:** Implements the Shared Seam signatures above. Consumes B1 tables + B2 perms.

- [ ] **B3.1** `eventOutputSchema`: add `myRole`, `canModerate`, `canSetPoints`, `deletedAt`. Add `resolveCapability` + populate these on every event returned to a member.
- [ ] **B3.2** `create`: `auth "admin"→"member"`, drop `permission`, `endsAt` required. Keep writing `status:"approved"`.
- [ ] **B3.3** Rename `listApproved`→`listPublished`; drop status filter, add `deletedAt IS NULL`. Grep + update callers (internal worker, any repo `calendar` read that filters status).
- [ ] **B3.4** **Strip `status == "approved"` gates** in `getById`, `rsvp`, `recordScan`, and in `event-forum.ts` (`:49`) + `event-media.ts` (`:26`/`:43`). Replace with `deletedAt IS NULL`.
- [ ] **B3.5** New ops `update`, `delete`(soft), `addStaff`, `removeStaff`, `transferOwnership`, `invite`, `listInvites` per capability matrix (spec §1). Transfer + demote in ONE tx; forbid owner staff row; can't remove final owner authority.
- [ ] **B3.6** `setPoints` (`event:points`): tx `UPDATE crs_events SET points=?` + `UPDATE retention_records SET points=? WHERE event_id=? AND source='event_attendance'`; batch-notify attendees; skip notify if null.
- [ ] **B3.7** `recordScan`: permission = event-staff or `event:moderate`; enforce window `[startsAt-CHECKIN_LEAD_MS, endsAt]` unless override actor; wrap attendance-insert + retention-insert (reading current `crs_events.points`) in ONE tx; **remove the scan-time points notification**.
- [ ] **B3.8** `searchMembers`: broad search requires owner/admin; plain scanner limited to exact member-id/QR lookup. `listAttendance`: event-staff or moderate.
- [ ] **B3.9** Delete `approve`/`reject` ops. Every new writer sets `sharedDev:"deny"`.
- [ ] **B3.10** Extend `events.integration.test.ts` (mirror existing style — `makeRepos`, `makeApprovedEvent`): window in/out for scanner vs override; role matrix (owner-only transfer/delete; admin adds admin+scanner not delete; scanner scan-only; non-staff rejected); setPoints re-values prior `event_attendance` rows + late scan inherits current; only `event:points` sets; invite writes rows+notifs, no visibility change; instant publish + soft-delete hides; **hard concern: soft-delete keeps retention rows attributable**. Run `pnpm test events`.
- [ ] **B3.11** `pnpm deploy:dev` (after approval) to sync shared-dev worker. Commit.

> ponytail: B3.10 lists concrete cases instead of literal test bodies because Codex TDDs against the existing `events.integration.test.ts` harness — same asserts, its own scaffolding. Upgrade path: if a case is ambiguous, Codex writes the failing test first and confirms it fails.

**Acceptance:** `pnpm test events` green; `pnpm typecheck`; shared-dev deploy succeeds.

## Phase B4 — Verification sweep [CODEX]
- [ ] **B4.1** `pnpm typecheck && pnpm test && pnpm lint` all green.
- [ ] **B4.2** Grep for any remaining `status === "approved"` / `event:approve` / `listApproved` references; fix stragglers.
- [ ] **B4.3** Confirm leaderboard/exports (`retention.ts` SUM paths) unchanged and still pass. Commit.

---

## Phase U1 — Create + capability plumbing [UI / Claude]

**Files:** New `src/app/portal/calendar/actions.ts`, `src/app/portal/calendar/create-event-dialog.tsx`; modify `src/app/portal/calendar/page.tsx`.

**Interfaces — Consumes:** `create`, `listPublished`, event output `myRole`/`canModerate`/`canSetPoints`.

- [ ] **U1.1** `actions.ts`: `createEventAction(input)` → `requireActor` → `repositories.events.create(actor, parsed)` → `revalidatePath("/portal/calendar")`. Zod: `endsAt` required, validate `endsAt > startsAt`.
- [ ] **U1.2** `create-event-dialog.tsx` (client): shadcn Dialog + form. **Native `datetime-local`** for start/end (ponytail: platform feature over a date-picker lib). Fields: title, type (official/casual/birthday), place, description, capacity (optional). No points field (CRS-only lever). Inline "end must be after start" validation.
- [ ] **U1.3** Add "Create event" button on calendar page (visible to every member). Wire dialog.
- [ ] **U1.4** Verify: create appears on calendar immediately (uses `verify` skill / drive the flow). Commit.

**Acceptance:** any member creates an event; it shows on the calendar without approval.

## Phase U2 — Event detail: staff, scanner, points, invites [UI / Claude]

**Files:** Modify `src/app/portal/calendar/[eventId]/page.tsx`; new colocated `[eventId]/actions.ts`, `[eventId]/event-admin-panel.tsx`, `[eventId]/scanner.tsx`, `[eventId]/points-lever.tsx`.

**Interfaces — Consumes:** `update`, `delete`, `addStaff`, `removeStaff`, `transferOwnership`, `invite`, `listInvites`, `setPoints`, `scan`, `searchMembers`, `listAttendance`, and event `myRole`/`canModerate`/`canSetPoints`.

- [ ] **U2.1** `actions.ts`: thin server actions wrapping each op above + `revalidatePath` of the detail route.
- [ ] **U2.2** Detail page: gate panels by the seam fields — show edit/staff/invite when `myRole` in (owner,admin) or `canModerate`; show transfer/delete when owner (delete also `canModerate`); show scanner when `myRole` set or `canModerate`; show points-lever only when `canSetPoints`.
- [ ] **U2.3** `event-admin-panel.tsx` (client): edit fields (reuse the U1 form shape); staff list with add/remove (admin/scanner) via `searchMembers`; transfer-ownership (owner only, confirm dialog); soft-delete (confirm dialog); invite members (multi-select via `searchMembers`) + current invitees from `listInvites`.
- [ ] **U2.4** `scanner.tsx` (client): mark-present flow using `searchMembers` + `scan`. Show window state: closed → disabled with "Check-in opens 30 min before start" for plain scanners; override actors see an "override" affordance. Surface `alreadyScanned`.
- [ ] **U2.5** `points-lever.tsx` (client, `canSetPoints` only): current value + input → `setPoints`; explains "re-values all attendees retroactively"; distinguishes null (unset) vs 0.
- [ ] **U2.6** Attendance list (server-read `listAttendance`) for staff.
- [ ] **U2.7** Verify each control against a running instance. Commit.

**Acceptance:** matrix (spec §1) holds in the UI — each role sees exactly its controls; scanner blocked outside window; only CRS admin sees points lever.

## Phase U3 — Invited surface [UI / Claude]

**Files:** Modify notifications rendering (invites already write `notifications`); optional calendar "Invited" filter.

- [ ] **U3.1** Ensure invite notifications render in the existing bell/notifications page with a link to the event. (v1 = bell only; calendar "Invited" filter is a fast-follow per spec §10.)
- [ ] **U3.2** Verify invite → notification appears; RSVP + visibility unchanged. Commit.

**Acceptance:** invited member gets a notification; event visibility/RSVP untouched.

---

## Self-Review (spec coverage)
- §1 roles/matrix → B3.5, U2.2. §2 create/visibility/soft-delete → B3.2/B3.3/B3.4, U1, fix#1/#2. §3 window → B3.7, U2.4. §4 points re-value + null/0 + race → B3.6/B3.7, U2.5, fix#3/#7. §5 invites → B3.5, U2.3/U3, fix#8. §6 permissions/rename → B2, fix#9. §7 contract table → B3. §8 migrations → B1. §9 tests → B3.10/B4. §11 all 11 fixes → mapped above. No gaps.

## Execution handoff
- **[CODEX]** B1→B4 dispatched to codex-rescue (pin: this plan only, backend phases only; caveman/ponytail/graphify; gated wrangler commands need Claude/user approval — Codex must PAUSE and surface them, not run them).
- **[UI]** U1→U3 by Claude with frontend-design skill, against the Shared Seam.
