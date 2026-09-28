---
type: "query"
date: "2026-07-29T15:09:08.236006+00:00"
question: "Why does production auth work while beta auth fails, and what is the safe fix?"
contributor: "graphify"
source_nodes: ["Database", "Production", "auth.ts"]
---

# Q: Why does production auth work while beta auth fails, and what is the safe fix?

## Answer

Expanded via graph vocab: [beta, production, auth, database, binding, migration, worker, deploy, cloudflare, drizzle, account]. Prod and beta use the same app pattern but separate D1 bindings. Prod D1 is healthy and answers under 2 ms. Beta binding is correct but its D1 SQL, database info, and Time Travel bookmark APIs fail with 7429 overload or 7500 internal error. Beta traffic is lower than prod, p90 was 0.55 ms, and there were no successful writes after 2026-07-29T10:00Z. Root cause is a stuck beta D1 instance. Safe self-service attempt is beta-only Time Travel restore to 2026-07-29T13:30:00Z, after explicit approval.

## Source Nodes

- Database
- Production
- auth.ts