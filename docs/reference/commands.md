# Commands

| Task | Command |
| --- | --- |
| Install | `pnpm install` |
| Local Next dev | `pnpm dev` |
| Cloudflare preview dev | `pnpm dev:cf` |
| Build | `pnpm build` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Unit and integration tests | `pnpm test` |
| E2E tests | `pnpm test:e2e` |
| Generate migration | `pnpm db:generate` |
| Apply local D1 migration | `pnpm db:migrate:local` |
| Apply shared/dev D1 migration | `pnpm db:migrate:dev` |
| Apply production D1 migration | `pnpm db:migrate:prod` |
| Deploy shared/dev | `pnpm deploy:dev` |
| Deploy production | `pnpm deploy:prod` |
| Cloudflare Workers build command | `pnpm build` |
| Cloudflare Workers deploy command | `pnpm upload:prod` |
| Generate Cloudflare types | `pnpm cf-typegen:dev` or `pnpm cf-typegen:prod` |

Useful Wrangler commands:

```bash
pnpm exec wrangler whoami
pnpm exec wrangler d1 list
pnpm exec wrangler r2 bucket list
pnpm exec wrangler tail code-nest
```

Before E2E tests, seed the local DB:

```bash
pnpm db:migrate:local:sqlite
pnpm db:seed:local
pnpm test:e2e
```
