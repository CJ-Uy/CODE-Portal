# Migrations

One history, shared by every environment. `0000` through `0003` are the history
production has always had. `0004_unify_schema.sql` brings a database up to what
`src/db/schema.ts` describes.

| Environment | Database | Config |
| --- | --- | --- |
| beta | `code-nest-beta-db` | `wrangler.beta.jsonc` |
| staging | `code-nest-staged-db` | `wrangler.staging.jsonc` |
| production | `code-nest-prod-db` | `wrangler.jsonc` |

Each environment sits at a prefix of this list. Apply outward, never inward:

    pnpm db:migrate:dev
    pnpm db:migrate:staged
    pnpm db:migrate:prod

`pnpm db:migrate:prod` passes no `--config` and reads `wrangler.jsonc` from whatever
tree is checked out, so these configs must stay correct on every branch.

Read what is pending without writing anything:

    pnpm exec wrangler d1 migrations list DB --config wrangler.staging.jsonc --remote

## Adding a change

Edit `src/db/schema.ts`, run `pnpm db:generate`, review the emitted file.

`drizzle-kit generate` writes **DDL only**. If your change needs a seed, a backfill or a
data copy, add it to the same file by hand and extend `scripts/verify-preservation.ts` to
assert it. This is not optional. `0004` exists because nine such statements lived in the
old history, and a generated migration would have dropped every one. An empty
`event_type_rules` means nobody can create an event.

## Checks

    pnpm exec tsx scripts/verify-trunk.ts         # this directory and schema.ts agree
    pnpm exec tsx scripts/verify-preservation.ts  # data survives 0004

`verify-trunk` replays this directory into one database, renders `schema.ts` into another,
and compares them structurally. Neither side derives from the other.

It compares `PRAGMA` output keyed by column name rather than `sqlite_master` text, because
text cannot work: `ALTER TABLE ADD COLUMN` appends to the end of a table while a
from-scratch render uses declaration order, so the same schema has two valid spellings.
An earlier version of this check compared text and reported 8 identical tables as
differing. An earlier version still ran `db:generate` twice and compared the result to a
snapshot `db:generate` had just written, which would have passed on a completely wrong
migration.

## Resetting a remote database

Do not attempt it as one `--file`. D1 rolls the entire file back on any failure, and no
drop order avoids a failure: while still inside the transaction SQLite resolves a dropped
table's foreign keys transitively, so dropping a parent walks into children that are
already gone. Issue one `DROP TABLE IF EXISTS` per call and repeat until nothing remains.
On both beta and staging this took two passes.

Never drop `_cf_KV` or anything else beginning with `_cf_`. Those are Cloudflare internals
and the obvious `NOT LIKE 'sqlite_%'` filter does not exclude them.

## Tables that are present but unused

`0000` created `articles`, `article_*`, `comments`, `consultancy_teams`, `favorites`,
`lists`, `list_items`, `point_awards`, `team_members` and `topics`. All were measured empty
in production and staging on 2026-08-07 and `0004` drops them.
