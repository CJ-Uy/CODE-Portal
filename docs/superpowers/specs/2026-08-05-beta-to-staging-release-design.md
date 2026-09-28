# Beta to Staging Release Design

Date: 2026-08-05
Status: Approved for implementation planning

## Goal

Promote the approved beta work to `code-nest-staged` without exposing unfinished
member modules, changing the current public root redirect, or risking existing
production short links and analytics.

This release is a staging rehearsal. It does not authorize a production deploy,
production migration, database reset, seed, or delete.

## Verified starting point

- `beta` is clean and matches `origin/beta`.
- `staging` and `beta` have diverged: staging has 31 unique commits and beta has
  289 unique commits.
- The staged D1 database is empty apart from Cloudflare system tables and an
  empty `d1_migrations` table.
- Production D1 uses the original migration lineage:
  `0000_young_bullseye.sql`, `0001_member_portal_links.sql`,
  `0002_link_workspace_fields.sql`, and `0003_admin_members_nav.sql`.
- Beta uses a different `0001` through `0019` lineage. Applying it directly to
  production would drop legacy tables and attempt to add existing short-link
  columns again.
- Production currently contains 159 short links and 176 daily-stat rows. Those
  counts are release baselines, not cleanup targets.

## Release scope

### Included

1. Short-link workspace and analytics.
2. Member profile updates.
3. Calendar, events, registration, attendance scanning, and points.
4. Events & Points administration and reports.
5. Member and access administration redesign.
6. Pinned member navigation and dashboard shortcuts.
7. Admin audit log UI.

Event administrators keep point assignment. The `events` role grants
`event:points`, and the events repository checks that permission before saving
event awards.

### Deferred and hard-disabled

1. Member retention progress and history UI.
2. Retention-only admin pages. Events & Points pages remain enabled even where
   legacy internal names still say `retention`.
3. Member content library and its admin pages.
4. Announcements and their admin pages.
5. Notification bell, notification feed, actions, and new notification writes.
6. General surveys and their member/admin/API entry points. Event registration
   questions remain enabled because they belong to Events.
7. Beta's new public website, services, projects, product, contact, and related
   APIs.

When the public-site flag is disabled, `/` must continue redirecting to
`https://sites.google.com/view/ateneo-code/landing`. Beta-only public routes must
return `404`.

## Feature flags

Add six server-owned runtime flags:

```text
FEATURE_RETENTION
FEATURE_LIBRARY
FEATURE_ANNOUNCEMENTS
FEATURE_NOTIFICATIONS
FEATURE_SURVEYS
FEATURE_PUBLIC_SITE
```

Only the literal string `true` enables a flag. Missing, empty, or malformed
values fail closed.

| Environment | Retention | Library | Announcements | Notifications | Surveys | Public site |
|---|---:|---:|---:|---:|---:|---:|
| Beta | on | on | on | on | on | on |
| Staging | off | off | off | off | off | off |
| Production | off | off | off | off | off | off |

The flags are enforced at every relevant boundary:

- Server layout filters member navigation, admin navigation, breadcrumbs, and
  the notification bell before props reach client components.
- Portal overview skips disabled queries and omits disabled cards and digests.
- Disabled member and admin pages call `notFound()` before repository access.
- Disabled route handlers and server actions reject requests before reads or
  writes.
- The single notification writer performs no insert while notifications are
  disabled, preventing a stale notification backlog at a future launch.
- Public root behavior selects the existing external redirect when the public
  site is disabled. Other beta-only public routes and related APIs return `404`.

Flags control product availability, not authorization. Existing role and
ownership checks remain mandatory when a feature is enabled.

## Branch integration

1. Add and verify feature guards on `beta` as one reviewable change.
2. Create a dated release branch from `staging`.
3. Merge the updated `beta` branch into the release branch.
4. Preserve staging-only Cloudflare configuration and the established
   production-compatible migration history while resolving conflicts.
5. Run all local gates before updating `staging`.
6. Merge the reviewed release branch into `staging` only after local checks pass.

Selective feature cherry-picks are rejected. The approved modules share schema,
repository, navigation, and authorization changes across the beta history, so
partial commit selection has a higher omission risk.

## Database migration design

### Separate release migration track

Keep beta's existing migration directory unchanged because the shared beta D1
database already records that history. Add a production-compatible release
migration directory used only by staging and production.

The release track contains the four migrations already recorded by production,
followed by new bridge migrations. This lets Cloudflare skip the four known
migrations on production and apply only the bridge.

The bridge must:

- preserve every existing short-link and daily-stat row;
- never drop a current production table or column;
- avoid re-adding columns already present in production;
- add only the tables, columns, indexes, and seed-independent defaults needed by
  the included release features;
- leave deferred-feature legacy tables dormant when replacing them would risk
  data loss;
- support both the old Worker during database-first rollout and the new Worker
  after deployment.

Because beta and production already have different migration histories, future
schema changes must be added to both tracks until a separately approved database
lineage consolidation is performed.

### Staging rehearsal

1. Initialize the empty staged D1 database with the production-compatible four
   migration baseline.
2. Apply the bridge migration.
3. Use only synthetic staging data. Do not copy production member or content
   data.
4. Create test members, links, events, attendance, and point awards through the
   UI wherever the behavior is under test.
5. Record exact synthetic IDs and delete only records created by that run when
   supported.

Every remote D1 migration command must be shown verbatim and approved before it
runs.

## Deployment sequence

1. Verify clean branches and record exact beta, staging, and merge commit IDs.
2. Run lint, typecheck, unit/integration tests, and production build locally.
3. Run migration preflight against a local database built from the production
   migration lineage and populated with representative synthetic short links and
   stats.
4. Record the staged D1 Time Travel bookmark.
5. With explicit approval, apply the staged baseline and bridge migrations.
6. Verify staged schema and migration history before deploying code.
7. With explicit approval, deploy the exact reviewed commit to
   `code-nest-staged` using `wrangler.staging.jsonc`.
8. Run read-only smoke checks first, then synthetic stateful journeys.
9. Produce the release report and stop. Production promotion is a separate,
   explicitly approved operation.

## Release gates

### Build and automated checks

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- Focused feature-flag tests for parsing, navigation filtering, route guards,
  action/API guards, overview queries, root redirect, and notification no-op.
- Migration rehearsal tests from production-compatible schema to release schema,
  asserting preserved rows and usable indexes.

### Staging user journeys

Run critical paths on desktop Chrome, emulated iPhone, and emulated Android.

#### Short links: blocking priority

- Existing schema and baseline counts survive migration.
- Existing sampled slugs still redirect to the same destinations.
- Existing aggregate click counts and 176 daily-stat rows remain unchanged by
  migration.
- A synthetic member can create, edit, tag, find, and delete only its own link.
- A moderator can use the moderation view.
- Redirect clicks update totals without breaking redirects when stats recording
  fails.
- Daily/hourly, device, and referrer analytics render correctly.
- QR customization, preview, copy, and export work on desktop and mobile.

Any short-link preservation failure blocks the release.

#### Profile

- Profile view/edit toggle works.
- Invalid edits show useful errors.
- Saved profile fields persist.
- Birthday visibility follows the birthday event-type setting.
- Point breakdown shows only the signed-in member's records.

#### Events & Points

- Authorized member creates an allowed event; unauthorized event types fail
  closed.
- Admin approves the exact event.
- Member submits registration questions with configured response visibility.
- Scanner records attendance once, reports duplicates, identifies lateness using
  the event grace period, and safely reverses the exact scan.
- Event admin with `event:points` assigns multiple point types to the event.
- Attendance creates the configured point awards; reversal removes corresponding
  attendance-source awards atomically.
- Event, member, scan-log, ledger, type-management, and export admin screens show
  consistent results.

#### Included admin tools

- Searchable member list, bulk invite, and role assignment preserve access
  boundaries.
- Pinned navigation and dashboard shortcuts render and can be managed by the
  correct role.
- Audit log records and phrases tested admin actions correctly.

#### Deferred modules

- No member or admin navigation entry appears for retention, library,
  announcements, notifications, surveys, or the new public website.
- Each disabled page and API returns `404`.
- Portal overview performs no deferred-module reads.
- Event, point, and survey-related activity creates zero notification rows while
  notifications are disabled.
- `/` keeps the current Google Sites redirect.

## Rollback

- Worker regression: roll back to the recorded previous staged Worker version.
- Additive bridge migration: leave compatible additions in place when the old
  Worker can continue safely.
- Data/schema corruption: restore staged D1 to the recorded Time Travel bookmark
  only after showing the exact destructive restore command and receiving
  approval.
- Never use a retry to repeat an ambiguous stateful action. Inspect logs and data
  first.

## Boss-ready release report

The report starts with plain language and keeps commands, hashes, and migration
details in a technical appendix.

### What this update adds

- **Better short links:** Members can find, organize, and manage shared short
  links more easily, view richer traffic trends, and create branded QR codes.
- **Improved member profiles:** Members get a clearer profile view and edit flow,
  better feedback when saving, birthday visibility controls, and a breakdown of
  earned points.
- **Stronger event calendar:** Events can span multiple days, use clear category
  colors, support all-day and read-only states, and be shared more easily.
- **Flexible event registration:** Organizers can collect event-specific signup
  information and control who may view responses.
- **Faster attendance:** Event teams get a mobile camera scanner with torch
  support, duplicate warnings, late-arrival tracking, and safe scan reversal.
- **Flexible points:** Event admins can assign one or more point types to an event
  while preserving historical awards.
- **Clear Events & Points administration:** Admins get focused dashboards for
  events, members, scans, point records, configuration, and exports.
- **Simpler member administration:** Search, bulk invitations, and role management
  are easier to use while preserving access controls.
- **Useful admin controls:** Authorized admins can manage pinned navigation,
  dashboard shortcuts, and review an audit log of important actions.

### Planned future features

- Member retention progress and history.
- Private content library.
- Organization announcements.
- Member notification center.
- General survey tools.
- New public Ateneo CODE website.

### Intentionally unchanged

- The production short-link service remains the priority and all current link
  records must be preserved.
- The base URL continues redirecting to the current Google Sites landing page.
- Deferred features remain inaccessible even by direct URL.

### Technical appendix

- Source and deployed commit IDs.
- Worker version before and after deployment.
- D1 bookmark and migration list.
- Short-link and stats counts before and after migration.
- Automated check results and device matrix.
- Artifact links, defects, interruptions, and rollback outcome if used.

## Definition of done

The staging release is complete only when:

1. All local checks pass.
2. Production-compatible migration rehearsal preserves every synthetic baseline
   row.
3. Staged migration and deploy commands were separately approved and succeeded.
4. Short-link preservation and functionality pass on all three device profiles.
5. Profile, Events & Points, member/access admin, pinned links, shortcuts, and
   audit log pass their journeys.
6. Every deferred route is absent from navigation and returns `404` directly.
7. No notification rows are created while notifications are disabled.
8. Release report and artifacts are available.
9. No production mutation occurred.
