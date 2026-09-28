---
type: "query"
date: "2026-07-28T18:24:45.921005+00:00"
question: "Audit B3 dev D1 migration state, typed-points seed behavior, and shared Worker redeploy need"
contributor: "graphify"
source_nodes: ["Migrations", "Database", "Shared Dev", "RETENTION"]
---

# Q: Audit B3 dev D1 migration state, typed-points seed behavior, and shared Worker redeploy need

## Answer

Expanded from original request via graph vocab: [migration, migrations, seed, point, retention, contract, worker, shared, database, type, award, event]. Remote Wrangler authority shows 0000-0010 applied and 0011-0013 pending. Legacy duplicate preflight returned zero rows. Dev seed defines Retention, Frontliner, and Project Lead, but db:seed:dev performs no remote write; use one explicit Retention INSERT instead of broad seed. B3 removed eventsContract.setPoints, so code-nest-beta requires redeploy for shared contract consistency.

## Source Nodes

- Migrations
- Database
- Shared Dev
- RETENTION