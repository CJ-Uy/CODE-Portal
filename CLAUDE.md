# CODE Portal Rules

- Keep `/` public and reader-first. Keep the member workspace under `/portal`.
- Use the Drizzle schema in `src/db/schema.ts` as the only schema source.
- Do not expose D1 as `DATABASE_URL`.
- Do not add raw SQL internal endpoints.
- After changing schema, migrations, internal contracts, permissions, auth config, storage proxy code, or shared dev seed data, update the dev Worker path. The usual order is `pnpm db:migrate:dev` then `pnpm deploy:dev`.
- Show the exact `pnpm exec wrangler` command and wait for approval before any D1 reset, migration, seed, delete, or production-touching operation.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
