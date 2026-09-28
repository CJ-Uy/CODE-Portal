# Admin Console Redesign — Adversarial Review Log (non-normative)

Companion to `2026-07-04-admin-console-redesign-design.md`. Records what each adversarial pass
raised and how it was dispositioned, so rejected findings don't get re-litigated. **Not a spec** —
the design doc is the single normative source.

## Round 1 (Codex run cancelled; ChatGPT pass, folded after repo verification)

**Accepted & folded into the spec:** atomic server-computed role diff via `db.batch` (#2,13,23),
race-safe last-super guarded delete (#1), super-check independent of `role:assign` (#3), route/link
migration inventory + page-level guards (#6,7,9,20,21,30), dynamic-segment breadcrumb (#8), bulk-add
limits/idempotency/result-shape/shared parser (#10,11,12,27,28), shared-dev write-fail-loud (#15),
search min-length+cap + permission-coupling note (#17,18,24), group-index not-found (#19), compact
intro cards (#29), Events-inactive label (#16), status reclassified (#31), target eligibility (#4).

**Rejected after verifying against the repo:**
- **#5 (role-change lag):** false — `src/auth.ts` uses `session.strategy="database"`; the `session()`
  callback re-queries `member_roles` from D1 every request, so revocation is immediate. Only the
  spec's "next sign-in" copy was wrong (fixed).
- **#14 (`assigned_by` nullable):** `Actor.memberId` is a required `string`.
- **#25 (rate-limit role/search/bulk):** YAGNI for a small trusted admin set behind auth; audit is
  the accountability control.
- **#26 (CSRF):** Next server actions are same-origin POST; app runs `assertSameOrigin` with
  same-site Auth.js cookies.

## Round 2 (ChatGPT, verdict "fix-first")

**Accepted & folded (the substantive one first):**
- **#2/#3/#4 — unified save path.** Real gap: the "Save changes" desired-set UI was described while
  guardrails were written against per-role actions. Fixed: ONE `saveMemberRolesAction(memberId,
  desiredRoleKeys, baseVersion)` that (a) fails closed if `actor.memberId` missing, (b) uses
  optimistic concurrency (baseVersion = hash of the member's current role-key set; reject stale
  saves → "roles changed, reload"), (c) computes the diff server-side, (d) rejects any `super` delta
  in the whole diff unless the actor is `super`, (e) routes every `super` removal through the guarded
  conditional delete, (f) writes all changes + audit rows in one `db.batch`.
- **#5/#10 — member eligibility:** search and assignment restricted to `status='active'` members;
  roster emails with no `members` row can't be targeted at all (no id to assign to).
- **#6 — Events placeholder:** no longer assignable — shown as a disabled "coming soon" row, activated
  only by the events-system spec (removes the silent-future-escalation trap).
- **#9 — breadcrumb dynamic label:** exact behavior specified (reuse `detailTitles` generic label; no
  extra fetch in the shell).
- **#11 — fail-closed `assigned_by` assert** kept even though the type guarantees it.
- **#12 — search gate made exact:** the roles-page search authorizes on `role:assign` (the page's own
  permission), decoupled from `member:manage`.
- **#14 — new mutation actions must call `assertSameOrigin`** (stated explicitly).
- **#15/#16/#17/#18 — bulk-add specifics:** max bytes + max-invalids cap; separate counts
  `{ added, alreadyMembers, dedupedInput, invalid }`; explicit partial-success UX + copyable invalid
  list; canonical email behavior (plain RFC-ish only, no display-name/quoted forms, lowercase dedupe,
  no provider-specific equivalence).
- **#23 — group index:** decided `notFound()` when no authorized children.
- **#24/#25 — shared-dev reads:** admin-critical reads surface an explicit "unavailable" state (not
  `[]`); writes throw a typed error with user-facing copy.
- **#26 — nav.ts:** split a minimal typed route registry (segment/label/href/permission) from intro
  copy so it isn't a god object.
- **#8 (grep gate):** the "no old `/portal/admin/<old>` string remains" check spans the whole repo
  (src, e2e, docs, seed, config) as an acceptance criterion.

**Verified already-correct (annotated in spec, no change needed):**
- **#20** `term_member_roster` PK `(termId, email)` — confirmed in `schema.ts:296`.
- **#21** audit accepts arbitrary action strings (free-form `action` field; e.g. `member:create`,
  `event:scan_attendance`) — no enum, no migration.
- **#27** `member_roles.assigned_by` exists (`schema.ts:112`); no schema migration for the roles work.
- **#1/#19** `db.batch` atomicity — D1 runs a batch as one transaction and rolls back on any failure
  (master plan §3.4; used in `surveys.ts`, retention). A rollback test is added rather than asserting.

**Held (pushed back, with reasoning):**
- **#7 (mandatory redirects):** kept optional. Internal, auth-gated routes; the whole-repo grep gate
  catches internal references, and there are no known external bookmarks. Redirects remain a cheap
  optional safety net, not a requirement.
- **#13 (rate-limit role mutations):** held. The ≤500 bulk cap already bounds paste abuse; role
  mutations by a small trusted, audited admin set don't warrant rate-limit machinery. Revisit on
  evidence of abuse.
- **#28/#29/#30 (status / disposition placement):** accepted the editorial half — this log now holds
  the disposition and process history; the spec is normative-only. Status set to ready for planning
  because the one substantive item (concurrency) is resolved.

**Process note:** two adversarial passes reached diminishing returns — round 2 was mostly specificity
and re-raised repo-claims already verified in round 1. Proceeding to implementation planning.
