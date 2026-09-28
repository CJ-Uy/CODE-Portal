# B3 dev database rollout

Date: 2026-07-29
Branch: `beta` at `821afc8`
Scope: dev D1 `code-nest-dev-db` through binding `DB` and `wrangler.beta.jsonc` only

## Status

Phase 1 audit complete. Phase 2 proposal approved. Phase 3 migration, one-row Retention insert, and dev Worker deploy complete.

Authenticated UI smoke testing could not run because no in-app or Chrome browser was connected. Unauthenticated requests confirmed all three protected routes are live and redirect to `/signin`.

## Audit commands and real output

### Graph orientation

Command:

```text
graphify query "migration migrations seed point retention contract worker shared database type award event" --budget 3000
```

Output:

```text
Traversal: BFS depth=2 | Start: ['Migrations', 'Database', 'RETENTION'] | 20 nodes found
```

Relevant graph sources:

- `docs/operations/migrations.md`
- `docs/architecture/database.md`
- `design/member-data.jsx`

Graph lacked B3 seed and contract detail, so the audit continued with targeted source reads.

### Local migration inventory

Command:

```powershell
Get-ChildItem -LiteralPath 'drizzle\migrations' -File | Sort-Object Name | Select-Object -ExpandProperty Name
```

Output:

```text
0000_young_bullseye.sql
0001_v5_drop_deferred.sql
0002_v5_add_foundation.sql
0003_phase_9_rate_limit_counters.sql
0004_robust_blue_shield.sql
0005_bored_luke_cage.sql
0006_bright_glorian.sql
0007_flippant_leech.sql
0008_elite_rogue.sql
0009_events_member_owned.sql
0010_event_type_rules.sql
0011_link_hourly_stats.sql
0012_event_type_metadata.sql
0013_additive_points_schema.sql
```

### Authoritative remote migration state

Command:

```text
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
```

Output:

```text
⛅️ wrangler 4.98.0
───────────────────
Resource location: remote

Migrations to be applied:
┌─────────────────────────────────┐
│ Name                            │
├─────────────────────────────────┤
│ 0011_link_hourly_stats.sql      │
├─────────────────────────────────┤
│ 0012_event_type_metadata.sql    │
├─────────────────────────────────┤
│ 0013_additive_points_schema.sql │
└─────────────────────────────────┘
```

Wrangler lists only pending local migrations. Therefore 0000 through 0010 are applied on remote dev D1, while 0011 through 0013 are pending.

| Migration | Applied on dev D1 |
|---|---:|
| `0000_young_bullseye.sql` | Yes |
| `0001_v5_drop_deferred.sql` | Yes |
| `0002_v5_add_foundation.sql` | Yes |
| `0003_phase_9_rate_limit_counters.sql` | Yes |
| `0004_robust_blue_shield.sql` | Yes |
| `0005_bored_luke_cage.sql` | Yes |
| `0006_bright_glorian.sql` | Yes |
| `0007_flippant_leech.sql` | Yes |
| `0008_elite_rogue.sql` | Yes |
| `0009_events_member_owned.sql` | Yes |
| `0010_event_type_rules.sql` | Yes |
| `0011_link_hourly_stats.sql` | No |
| `0012_event_type_metadata.sql` | No |
| `0013_additive_points_schema.sql` | No |

### Required duplicate preflight

Migration 0013 creates a partial unique index over event-attendance retention rows. Existing duplicates would make migration application fail. The checked-in B1 rollout plan requires this legacy-compatible query before 0013.

Command:

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT event_id, member_id, 'pt_retention' AS point_type_id, COUNT(*) c FROM retention_records WHERE source = 'event_attendance' GROUP BY 1,2 HAVING c > 1;"
```

Output:

```text
⛅️ wrangler 4.98.0 (update available 4.114.0)
──────────────────────────────────────────────
Resource location: remote

🌀 Executing on remote database DB (f9d2b16f-3358-49c2-a88e-e72c9339a22b):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.38ms
[
  {
    "results": [],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "APAC",
      "served_by_colo": "SIN",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.3826
      },
      "duration": 0.3826,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 606208,
      "rows_read": 5,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

Result: no duplicate event-attendance rows. Re-run immediately before migration because remote state can change between approval turns.

## Migration 0013 findings

`drizzle/migrations/0013_additive_points_schema.sql`:

- Creates `point_types`.
- Creates `event_point_awards`.
- Adds `retention_records.point_type_id TEXT NOT NULL DEFAULT 'pt_retention'`.
- Creates a unique partial index over `(event_id, member_id, point_type_id)` where `source = 'event_attendance'`.
- Inserts no `point_types` rows.
- Does not drop `crs_events.points`.

Pending migration effects:

- 0011 creates `link_hourly_stats` and its `(link_id, hour)` index.
- 0012 adds `label`, `colour`, `active`, and `position` to `event_type_rules`, then updates the built-in event types.
- 0013 adds the typed-points schema described above.

## Dev seed findings

`src/db/seed/data.ts` defines these `point_types` rows:

| id | key | label | counts toward retention | active | position |
|---|---|---|---:|---:|---:|
| `pt_retention` | `retention` | `Retention` | 1 | 1 | 0 |
| `pt_frontliner` | `frontliner` | `Frontliner` | 0 | 1 | 1 |
| `pt_project_lead` | `project_lead` | `Project Lead` | 0 | 1 | 2 |

`pnpm db:seed:dev` performs no remote write. `src/db/seed/run.ts` prints instructions and returns. The printed command omits `--config wrangler.beta.jsonc` and uses `--env dev`, so it must not be used for this rollout.

`pnpm db:seed:dev:export` builds a broad seed file. That file uses `INSERT OR IGNORE`, with no delete or replace. It is repeatable and non-destructive, but it inserts unrelated demo data across many tables and does not update existing rows. Running the full export is unnecessary.

Minimal approved SQL:

```sql
INSERT INTO point_types
	(id, key, label, counts_toward_retention, active, position)
VALUES
	('pt_retention', 'retention', 'Retention', 1, 1, 0);
```

Before this insert, query `point_types`. If any row already uses `pt_retention`, `retention`, or the retention flag, stop and review instead of overwriting or ignoring the conflict.

## Shared dev Worker finding

Redeploy required.

B3 commit `1b0f122` removed `eventsContract.setPoints` from `src/db/contract/events.ts`. `src/server/internal/events.ts` imports `eventsContract` into the deployed Worker bundle and dynamically resolves operations from it. Project rules also explicitly require a dev Worker redeploy after any `src/db/contract/*` change.

The removed operation had `sharedDev: "deny"`, so the stale Worker does not permit the old write. It still exposes stale contract behavior until redeployed. A stale `setPoints` request returns the old shared-dev denial; the new bundle treats it as unknown.

## Proposed Phase 3 command order

Commands below target `DB` with `wrangler.beta.jsonc` only. Stop on any unexpected result.

### 1. Reconfirm pending migrations

```text
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
```

Change: none.
Reversible: not applicable.

Expected: only 0011, 0012, and 0013 pending. If state differs, stop.

### 2. Re-run duplicate preflight

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT event_id, member_id, 'pt_retention' AS point_type_id, COUNT(*) c FROM retention_records WHERE source = 'event_attendance' GROUP BY 1,2 HAVING c > 1;"
```

Change: none.
Reversible: not applicable.

Expected: zero rows. If any row returns, stop before migration.

### 3. Apply pending migrations

```text
pnpm exec wrangler d1 migrations apply DB --config wrangler.beta.jsonc --remote
```

Change: applies 0011, 0012, and 0013 to dev D1 in order. This is the exact expansion of `pnpm db:migrate:dev`.
Reversible: no automatic Wrangler rollback. Reversal requires reviewed manual schema and data work, so treat as irreversible.

### 4. Confirm no pending migrations

```text
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
```

Change: none.
Reversible: not applicable.

Expected: no migrations to apply.

### 5. Confirm typed-points tables

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('point_types', 'event_point_awards') ORDER BY name;"
```

Change: none.
Reversible: not applicable.

Expected: `event_point_awards` and `point_types`.

### 6. Confirm retention column

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT name, type, dflt_value FROM pragma_table_info('retention_records') WHERE name = 'point_type_id';"
```

Change: none.
Reversible: not applicable.

Expected: `point_type_id`, type `TEXT`, default `'pt_retention'`.

### 7. Confirm legacy event points column remains

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT name, type, dflt_value FROM pragma_table_info('crs_events') WHERE name = 'points';"
```

Change: none.
Reversible: not applicable.

Expected: one `points` row. If absent, stop immediately.

### 8. Confirm post-migration duplicate state

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT event_id, member_id, point_type_id, COUNT(*) c FROM retention_records WHERE source = 'event_attendance' GROUP BY 1,2,3 HAVING c > 1;"
```

Change: none.
Reversible: not applicable.

Expected: zero rows.

### 9. Inspect point types before insert

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT id, key, label, counts_toward_retention, active, position FROM point_types ORDER BY position, key;"
```

Change: none.
Reversible: not applicable.

Expected: zero rows. If retention or a conflicting id/key already exists, stop.

### 10. Insert only Retention

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "INSERT INTO point_types (id, key, label, counts_toward_retention, active, position) VALUES ('pt_retention', 'retention', 'Retention', 1, 1, 0);"
```

Change: inserts one `point_types` row. No demo members, events, links, roles, tokens, or other point types.
Reversible: not automatically. A manual delete is possible only before dependent rows exist, is destructive, and is not part of this plan.

### 11. Confirm Retention row

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT id, key, label, counts_toward_retention, active FROM point_types ORDER BY position, key;"
```

Change: none.
Reversible: not applicable.

Expected:

```text
pt_retention | retention | Retention | 1 | 1
```

### 12. Build and deploy dev Worker

```text
pnpm deploy:dev
```

Change: builds current `beta` source and deploys a new `code-nest-beta` Worker version using `wrangler.beta.jsonc`.
Reversible: prior Worker version can be redeployed or rolled back, but rollback is a separate reviewed action.

### 13. Authenticated smoke check

Open these exact beta URLs in an authenticated browser session:

```text
https://beta.ateneocode.org/portal/admin/system/point-types
https://beta.ateneocode.org/portal/profile
https://beta.ateneocode.org/portal/events?view=leaderboard
```

Expected:

- Point types page loads and lists Retention.
- Profile shows a points breakdown without an error.
- Leaderboard shows a point-type selector defaulted to Retention.

If no authenticated beta session is available, report that limitation without inferring UI state.

## Risk and concerns

1. Remote 0010 is already applied, contrary to the reported belief. Remote state is ahead of that report, not behind at 0010.
2. 0011, 0012, and 0013 will apply together. Wrangler has no automatic migration rollback.
3. 0013's unique-index risk is currently clear: preflight returned zero duplicates after reading five event-attendance rows. Re-run before migration.
4. Full dev seed is broader than needed. `INSERT OR IGNORE` avoids replacement but can add many unrelated demo rows and silently preserve stale values. Use the one-row Retention insert.
5. `pnpm db:seed:dev` is misleading: it does not seed and prints a command without the required beta config. Do not use that printed command.
6. `docs/operations/migrations.md` still describes a clean reset path. Reset is forbidden for this rollout and is absent from the proposal.
7. Worker redeploy is required for contract consistency. Until then, deployed shared-dev contract behavior remains stale.

## Phase 3 execution log

### Reconfirm pending migrations

Command:

```text
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
```

Real output:

```text
⛅️ wrangler 4.98.0 (update available 4.114.0)
──────────────────────────────────────────────
Resource location: remote

Migrations to be applied:
┌─────────────────────────────────┐
│ Name                            │
├─────────────────────────────────┤
│ 0011_link_hourly_stats.sql      │
├─────────────────────────────────┤
│ 0012_event_type_metadata.sql    │
├─────────────────────────────────┤
│ 0013_additive_points_schema.sql │
└─────────────────────────────────┘
```

### Re-run duplicate preflight

Command:

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT event_id, member_id, 'pt_retention' AS point_type_id, COUNT(*) c FROM retention_records WHERE source = 'event_attendance' GROUP BY 1,2 HAVING c > 1;"
```

Real output:

```json
[
  {
    "results": [],
    "success": true,
    "meta": {
      "changes": 0,
      "changed_db": false,
      "rows_read": 5,
      "rows_written": 0
    }
  }
]
```

Result: zero duplicates. Migration allowed to proceed.

### Apply migrations

Command:

```text
pnpm exec wrangler d1 migrations apply DB --config wrangler.beta.jsonc --remote
```

Real output:

```text
⛅️ wrangler 4.98.0 (update available 4.114.0)
──────────────────────────────────────────────
Resource location: remote

Migrations to be applied:
┌─────────────────────────────────┐
│ name                            │
├─────────────────────────────────┤
│ 0011_link_hourly_stats.sql      │
├─────────────────────────────────┤
│ 0012_event_type_metadata.sql    │
├─────────────────────────────────┤
│ 0013_additive_points_schema.sql │
└─────────────────────────────────┘
? About to apply 3 migration(s)
Your database may not be available to serve requests during the migration, continue?
🤖 Using fallback value in non-interactive context: yes
🌀 Executing on remote database DB (f9d2b16f-3358-49c2-a88e-e72c9339a22b):
🚣 Executed 3 commands in 1.67ms
┌─────────────────────────────────┬────────┐
│ name                            │ status │
├─────────────────────────────────┼────────┤
│ 0011_link_hourly_stats.sql      │ ✅     │
│ 0012_event_type_metadata.sql    │ 🕒️    │
│ 0013_additive_points_schema.sql │ 🕒️    │
└─────────────────────────────────┴────────┘
🌀 Executing on remote database DB (f9d2b16f-3358-49c2-a88e-e72c9339a22b):
🚣 Executed 8 commands in 4.62ms
┌─────────────────────────────────┬────────┐
│ name                            │ status │
├─────────────────────────────────┼────────┤
│ 0011_link_hourly_stats.sql      │ ✅     │
│ 0012_event_type_metadata.sql    │ ✅     │
│ 0013_additive_points_schema.sql │ 🕒️    │
└─────────────────────────────────┴────────┘
🌀 Executing on remote database DB (f9d2b16f-3358-49c2-a88e-e72c9339a22b):
🚣 Executed 5 commands in 1.84ms
┌─────────────────────────────────┬────────┐
│ name                            │ status │
├─────────────────────────────────┼────────┤
│ 0011_link_hourly_stats.sql      │ ✅     │
│ 0012_event_type_metadata.sql    │ ✅     │
│ 0013_additive_points_schema.sql │ ✅     │
└─────────────────────────────────┴────────┘
```

Result: all three migrations applied successfully.

### Confirm no pending migrations

Command:

```text
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
```

Real output:

```text
⛅️ wrangler 4.98.0 (update available 4.114.0)
──────────────────────────────────────────────
Resource location: remote

✅ No migrations to apply!
```

### Confirm typed-points tables

Command:

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('point_types', 'event_point_awards') ORDER BY name;"
```

Real output:

```json
[
  {
    "results": [
      {
        "name": "event_point_awards"
      },
      {
        "name": "point_types"
      }
    ],
    "success": true,
    "meta": {
      "changes": 0,
      "changed_db": false,
      "rows_written": 0
    }
  }
]
```

### Confirm `retention_records.point_type_id`

Command:

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT name, type, dflt_value FROM pragma_table_info('retention_records') WHERE name = 'point_type_id';"
```

Real output:

```json
[
  {
    "results": [
      {
        "name": "point_type_id",
        "type": "TEXT",
        "dflt_value": "'pt_retention'"
      }
    ],
    "success": true
  }
]
```

### Confirm legacy `crs_events.points`

Command:

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT name, type, dflt_value FROM pragma_table_info('crs_events') WHERE name = 'points';"
```

Real output:

```json
[
  {
    "results": [
      {
        "name": "points",
        "type": "INTEGER",
        "dflt_value": null
      }
    ],
    "success": true
  }
]
```

Result: required legacy column remains.

### Confirm post-migration duplicate state

Command:

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT event_id, member_id, point_type_id, COUNT(*) c FROM retention_records WHERE source = 'event_attendance' GROUP BY 1,2,3 HAVING c > 1;"
```

Real output:

```json
[
  {
    "results": [],
    "success": true,
    "meta": {
      "changes": 0,
      "changed_db": false,
      "rows_read": 2,
      "rows_written": 0
    }
  }
]
```

### Inspect point types before insert

Command:

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT id, key, label, counts_toward_retention, active, position FROM point_types ORDER BY position, key;"
```

Real output:

```json
[
  {
    "results": [],
    "success": true,
    "meta": {
      "changes": 0,
      "changed_db": false,
      "rows_written": 0
    }
  }
]
```

Result: table empty. No id, key, or retention-flag conflict.

### Insert Retention only

Command:

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "INSERT INTO point_types (id, key, label, counts_toward_retention, active, position) VALUES ('pt_retention', 'retention', 'Retention', 1, 1, 0);"
```

Real output:

```json
[
  {
    "results": [],
    "success": true,
    "meta": {
      "changes": 1,
      "last_row_id": 1,
      "changed_db": true,
      "rows_read": 0,
      "rows_written": 3
    }
  }
]
```

Result: one logical row inserted. D1 reports three physical row writes because table indexes are maintained.

### Confirm Retention row

Command:

```text
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --command "SELECT id, key, label, counts_toward_retention, active FROM point_types ORDER BY position, key;"
```

Real output:

```json
[
  {
    "results": [
      {
        "id": "pt_retention",
        "key": "retention",
        "label": "Retention",
        "counts_toward_retention": 1,
        "active": 1
      }
    ],
    "success": true,
    "meta": {
      "changes": 0,
      "changed_db": false,
      "rows_written": 0
    }
  }
]
```

### Build and deploy dev Worker

Command:

```text
pnpm deploy:dev
```

Real output:

```text
> code-nest@0.1.0 deploy:dev
> pnpm build && pnpm upload:beta

> code-nest@0.1.0 build
> next build --webpack && node scripts/fix-windows-standalone-links.mjs && pnpm clean:opennext && opennextjs-cloudflare build --skipNextBuild

▲ Next.js 16.2.6 (webpack)
Creating an optimized production build ...
✓ Compiled successfully in 6.6s
Running TypeScript ...
Finished TypeScript in 16.4s
Generating static pages using 31 workers (29/29)
Finalizing page optimization ...
Collecting build traces ...

Repaired 9 Windows standalone links. Mirrored 149 missing links.

OpenNext build complete.

> code-nest@0.1.0 upload:beta
> npx --yes node@22 ./node_modules/wrangler/bin/wrangler.js deploy --no-x-autoconfig --config wrangler.beta.jsonc

⛅️ wrangler 4.98.0 (update available 4.114.0)
🌀 Read 249 files from the assets directory
🌀 Found 11 new or modified static assets to upload.
✨ Success! Uploaded 11 files (133 already uploaded) (1.24 sec)

Total Upload: 11134.94 KiB / gzip: 2325.50 KiB
Worker Startup Time: 32 ms

Uploaded code-nest-beta (16.09 sec)
Deployed code-nest-beta triggers (1.54 sec)
  https://code-nest-beta.cj-uy.workers.dev
  beta.ateneocode.org (custom domain)
Current Version ID: 0fc9e68e-e626-452f-bd30-9b02cd97832e
```

Result: build, TypeScript check, OpenNext bundle, asset upload, and Worker deployment succeeded.

### Deployed route smoke check

No in-app or Chrome browser was available, so authenticated UI state could not be inspected.

Command:

```text
curl.exe -sS -o NUL -w "point-types %{http_code} %{redirect_url}\n" "https://beta.ateneocode.org/portal/admin/system/point-types"; curl.exe -sS -o NUL -w "profile %{http_code} %{redirect_url}\n" "https://beta.ateneocode.org/portal/profile"; curl.exe -sS -o NUL -w "leaderboard %{http_code} %{redirect_url}\n" "https://beta.ateneocode.org/portal/events?view=leaderboard"
```

Real output:

```text
point-types 307 https://beta.ateneocode.org/signin
profile 307 https://beta.ateneocode.org/signin
leaderboard 307 https://beta.ateneocode.org/signin
```

Result:

- All three deployed routes respond.
- All three correctly require authentication and redirect to `/signin`.
- Retention row visibility, profile breakdown rendering, and leaderboard selector state remain unverified because no authenticated browser session was available.
