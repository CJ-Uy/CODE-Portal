# Setup Overview

CODE Nest is a Next.js App Router app deployed to Cloudflare Workers through OpenNext.

## Stack

- Next.js App Router for public pages, portal pages, and API routes.
- `@opennextjs/cloudflare` to build the Worker.
- Wrangler for local Worker preview, deployment, D1, and R2 operations.
- Cloudflare D1 for relational data.
- Cloudflare R2 for uploads and object storage.
- Drizzle ORM and Drizzle Kit for schema and migrations.
- Zod for environment validation.

## Runtime Shape

The app uses adapters so product code can call stable interfaces:

- `getDatabaseAdapter()` for typed user operations.
- `getStorageAdapter()` for upload and object operations.

Production selects Cloudflare binding adapters. Shared dev selects internal API clients. Local mode prefers local Cloudflare bindings when available and falls back to SQLite plus filesystem storage.

Read next: [Cloudflare, Drizzle, D1, and R2 setup](cloudflare-drizzle-d1-r2.md), [environment modes](environment-modes.md), [architecture overview](../architecture/overview.md).
