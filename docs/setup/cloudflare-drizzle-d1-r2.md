# Cloudflare, Drizzle, D1, and R2 Setup

This is the full setup path for CODE Nest on Cloudflare Workers.

The short version: production, beta, and staging use separate Wrangler configs and Workers. Drizzle generates SQLite SQL migrations, Wrangler applies those migrations to D1, and uploads go to R2 through a Worker binding.

## Runtime Map

| Target | Worker | Public host | `APP_ENV` | `DEPLOY_ENV` | D1 | R2 |
| --- | --- | --- | --- | --- | --- | --- |
| Local Next dev | none | `localhost:3000` | `local` | blank | SQLite at `LOCAL_SQLITE_PATH` | local files unless changed |
| Local Cloudflare preview | local Wrangler runtime | local Wrangler URL | `production` from `wrangler.beta.jsonc` | `dev` | local D1 binding | local R2 binding |
| Shared outside-dev mode | none | local app talks to beta API | `shared` | blank | beta Worker internal API | beta API, dev R2 S3, or local files |
| Beta | `code-nest-beta` | `beta.ateneocode.org` | `production` | `dev` | `code-nest-dev-db` | `code-nest-dev-uploads` |
| Staging | `code-nest-staged` | `staged.ateneocode.org` | `production` | `prod` | `code-nest-staged-db` | `code-nest-staged-uploads` |
| Production | `code-nest` | `ateneocode.org` | `production` | `prod` | `code-nest-prod-db` | `code-nest-prod-uploads` |

`APP_ENV=production` means "use Cloudflare bindings." `DEPLOY_ENV=dev` is what keeps the beta Worker separated from real production data.

## Cloudflare Resources

Current resource names live in `wrangler.jsonc`.

| Purpose | Resource | Name | Binding |
| --- | --- | --- | --- |
| Beta database | D1 | `code-nest-dev-db` | `DB` |
| Staged database | D1 | `code-nest-staged-db` | `DB` |
| Production database | D1 | `code-nest-prod-db` | `DB` |
| Beta uploads | R2 | `code-nest-dev-uploads` | `BUCKET` |
| Staged uploads | R2 | `code-nest-staged-uploads` | `BUCKET` |
| Production uploads | R2 | `code-nest-prod-uploads` | `BUCKET` |

The database IDs are checked into `wrangler.jsonc` because D1 bindings need them. R2 bindings only need bucket names.

## First-Time Cloudflare Setup

Install dependencies and authenticate Wrangler:

```bash
pnpm install
pnpm exec wrangler login
pnpm exec wrangler whoami
```

Create the two D1 databases:

```bash
pnpm exec wrangler d1 create code-nest-dev-db
pnpm exec wrangler d1 create code-nest-prod-db
```

Copy the returned database IDs into `wrangler.jsonc`:

```jsonc
"d1_databases": [
	{
		"binding": "DB",
		"database_name": "code-nest-prod-db",
		"database_id": "...",
		"migrations_dir": "drizzle/migrations"
	}
]
```

Create the two R2 buckets:

```bash
pnpm exec wrangler r2 bucket create code-nest-dev-uploads
pnpm exec wrangler r2 bucket create code-nest-prod-uploads
```

Bind production resources in `wrangler.jsonc`, beta resources in `wrangler.beta.jsonc`, and staging resources in `wrangler.staging.jsonc`.

## Worker Configs

Production is the top-level Wrangler environment:

```jsonc
{
	"name": "code-nest",
	"routes": [{ "pattern": "ateneocode.org", "custom_domain": true }],
	"vars": {
		"APP_ENV": "production",
		"DEPLOY_ENV": "prod",
		"STORAGE_MODE": "binding"
	}
}
```

Beta is a standalone Worker:

```jsonc
{
	"name": "code-nest-beta",
	"routes": [{ "pattern": "beta.ateneocode.org", "custom_domain": true }],
	"vars": {
		"APP_ENV": "production",
		"DEPLOY_ENV": "dev",
		"STORAGE_MODE": "binding"
	}
}
```

Deploy beta with:

```bash
pnpm deploy:beta
```

Deploy staged from the production branch with:

```bash
pnpm deploy:staged
```

Deploy production with:

```bash
pnpm deploy:prod
```

Each upload script passes its matching Wrangler config explicitly.

## Secrets

Do not put real secrets in `wrangler.jsonc` or committed env files.

Set beta secrets with `wrangler.beta.jsonc`:

```bash
pnpm exec wrangler secret put AUTH_SECRET --config wrangler.beta.jsonc
pnpm exec wrangler secret put AUTH_GOOGLE_ID --config wrangler.beta.jsonc
pnpm exec wrangler secret put AUTH_GOOGLE_SECRET --config wrangler.beta.jsonc
pnpm exec wrangler secret put AUTH_URL --config wrangler.beta.jsonc
pnpm exec wrangler secret put APP_BASE_URL --config wrangler.beta.jsonc
pnpm exec wrangler secret put SHARED_API_ALLOWED_ORIGINS --config wrangler.beta.jsonc
```

Set production secrets without an env flag:

```bash
pnpm exec wrangler secret put AUTH_SECRET
pnpm exec wrangler secret put AUTH_GOOGLE_ID
pnpm exec wrangler secret put AUTH_GOOGLE_SECRET
pnpm exec wrangler secret put AUTH_URL
pnpm exec wrangler secret put APP_BASE_URL
pnpm exec wrangler secret put AUTH_ALLOWED_DOMAINS
pnpm exec wrangler secret put AUTH_BOOTSTRAP_SUPER_ADMIN_EMAIL
```

Production must not set `SHARED_API_BASE_URL`, `SHARED_API_TOKEN`, or `SHARED_API_ALLOWED_ORIGINS`.

## Drizzle and D1

Drizzle schema lives at `src/db/schema.ts`.

Drizzle Kit is configured in `drizzle.config.ts`:

```ts
export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle/migrations",
	dialect: "sqlite",
});
```

D1 is SQLite, so Drizzle generates SQLite migrations into `drizzle/migrations`. Wrangler applies those SQL files to local, beta, or production D1.

Generate a migration after changing `src/db/schema.ts`:

```bash
pnpm db:generate
```

Apply migrations locally:

```bash
pnpm db:migrate:local
```

Apply migrations to beta:

```bash
pnpm db:migrate:beta
```

Apply migrations to staged from the production branch:

```bash
pnpm db:migrate:staged
```

Apply migrations to production:

```bash
pnpm db:migrate:prod
```

Production migrations are approval-gated. Show the exact command and wait for approval before running a production D1 migration, reset, seed, delete, or other production-touching command.

## Database Adapter Flow

Application code should not reach for D1 directly. It goes through `getDatabaseAdapter()` or `getRepositories()`.

| Mode | Adapter |
| --- | --- |
| `APP_ENV=production` | `D1DatabaseAdapter` using `env.DB` |
| `APP_ENV=shared` | `SharedApiDatabaseAdapter` using `/internal/*` |
| `APP_ENV=local` with `DB` binding | `D1DatabaseAdapter` |
| `APP_ENV=local` without `DB` binding | `LocalSqliteDatabaseAdapter` |

The raw Drizzle D1 client is isolated in `src/db/client.ts` and `src/db/adapters/d1.ts`.

## R2 Storage Flow

Application code should use `getStorageAdapter()`.

| Mode | Adapter |
| --- | --- |
| Production default | `R2BindingStorageAdapter` using `env.BUCKET` |
| `STORAGE_MODE=binding` | `R2BindingStorageAdapter` |
| `STORAGE_MODE=r2-s3` | `R2S3StorageAdapter` with dev-only R2 S3 credentials |
| `STORAGE_MODE=api` | `SharedApiStorageAdapter` using `/internal/uploads` |
| Local fallback | `LocalFileStorageAdapter` |

Production always uses the R2 binding unless `ALLOW_PRODUCTION_STORAGE_MODE_OVERRIDE=true` is set for a documented emergency.

## Shared Development

Outside developers should not receive Cloudflare account access, production D1 access, or production R2 credentials.

They use:

```env
APP_ENV=shared
STORAGE_MODE=api
SHARED_API_BASE_URL=https://beta.ateneocode.org
SHARED_API_TOKEN=provided_token
LOCAL_SQLITE_PATH=./.local/dev.db
LOCAL_STORAGE_DIR=./.local/uploads
```

Shared mode calls the beta Worker internal API. That API uses beta D1 and beta R2 behind bearer-token checks. There is no raw SQL endpoint.

Use `STORAGE_MODE=r2-s3` only for dev-only direct upload testing, and only with credentials scoped to `code-nest-dev-uploads`.

## Beta Refresh Checklist

Run this after schema, migrations, internal contracts, permissions, shared actor logic, shared token seed data, auth config, storage internals, or Worker runtime dependencies change:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm db:migrate:beta
pnpm db:seed:dev:export
pnpm exec wrangler d1 execute DB --config wrangler.beta.jsonc --remote --file .local/dev-seed.sql
pnpm deploy:beta
```

Before the D1 migration or seed command, show the exact command and wait for approval.

## Production Deploy Checklist

Use this only after beta has been checked:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm db:migrate:prod
pnpm deploy:prod
```

Before `pnpm db:migrate:prod` or `pnpm deploy:prod`, show the exact command and wait for approval.

After deploy, check `/api/health`:

- `APP_ENV` is `production`.
- `DEPLOY_ENV` is `prod` on production or `dev` on beta.
- Database adapter is `d1-binding`.
- Storage adapter is `r2-binding`.
- `cloudflareBindings.DB` and `cloudflareBindings.BUCKET` are true.

## Useful Commands

```bash
pnpm exec wrangler d1 list
pnpm exec wrangler d1 migrations list DB --config wrangler.beta.jsonc --remote
pnpm exec wrangler d1 migrations list code-nest-prod-db --remote
pnpm exec wrangler r2 bucket list
pnpm exec wrangler tail code-nest-beta
pnpm exec wrangler tail code-nest
pnpm cf-typegen:dev
pnpm cf-typegen:prod
```

## Cloudflare References

- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [R2 bucket creation](https://developers.cloudflare.com/r2/buckets/create-buckets/)
- [R2 Wrangler commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/)
