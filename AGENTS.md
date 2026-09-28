# Agent notes

## Working style

- Keep the app simple and member-first.
- Keep `/` public and reader-first. Keep the member workspace at `/portal`.
- Use Tailwind CSS v4 tokens from `src/app/globals.css`.
- Use shadcn-style components from `src/components/ui` before adding one-off control styles.
- Use lucide icons inside buttons when an icon exists.
- Keep cards shallow. Do not place cards inside cards.
- Avoid em dashes in code comments, UI copy, docs, commits, and README text.
- Avoid generic AI-sounding wording. Use plain, specific product language.
- Use the supplied CODE palette from the brand manual: navy `#06192F`, white `#FFFFFF`, blue `#0C315C`, light blue `#D7DFE9`, dark gray `#121315`, pale blue `#90B4CC`, and supporting grays `#3D5266`, `#343B41`, `#717D89`, and `#AAAFB5`.
- Use Unna for headings and Source Sans for body text.
- Keep official logo colors intact. Do not recolor, stretch, crop, outline, shadow, or manipulate the logo.

## Product priorities

1. Public publishing home, public articles, and public resource previews.
2. Hidden or low-emphasis member access into `/portal`.
3. Signed-in member overview.
4. Private content library with filters, comments, favorites, and lists.
5. Official short links with QR export and shared stats.
6. CRS event lifecycle with scan, archive, forum, survey sample, approval, and points.
7. Shared calendar and announcements.
8. Scoped admin roles, super admin inheritance, audit logs, and replayable tours.

## Verification

- Run `pnpm lint` when lint support is available.
- Run `pnpm build` before claiming the UI compiles.
- Check mobile and desktop layouts for horizontal overflow.

## Shared dev Worker

The `shared` access mode depends on the deployed beta Worker `code-nest-beta`. It owns `code-nest-dev-db`, `code-nest-dev-uploads`, and the `/internal/*` API used by outside developers.

Redeploy the dev Worker, and migrate or seed dev D1 when needed, after changes to:

- `src/db/schema.ts` or `drizzle/migrations`.
- `src/db/contract/*` or `src/app/internal/*`.
- `src/server/auth/permissions.ts`, shared actor resolution, or shared dev token seed data.
- Seed data that outside developers rely on.
- `src/auth.ts`, `src/server/env.ts`, or `wrangler.jsonc`.
- `/internal/uploads` or `src/storage/adapters/shared-api.ts`.
- Worker runtime dependencies such as Auth.js, Drizzle, OpenNext, or Wrangler.

Show the exact `pnpm exec wrangler` command and wait for approval before any D1 reset, migration, seed, delete, or production-touching command.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
