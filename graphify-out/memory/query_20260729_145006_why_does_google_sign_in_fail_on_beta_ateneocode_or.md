---
type: "query"
date: "2026-07-29T14:50:06.780580+00:00"
question: "Why does Google sign-in fail on beta.ateneocode.org with Auth.js AdapterError?"
contributor: "graphify"
source_nodes: ["auth.ts", "schema.ts", "Database"]
---

# Q: Why does Google sign-in fail on beta.ateneocode.org with Auth.js AdapterError?

## Answer

Expanded via graph vocab: [auth, adapter, google, callback, drizzle, database, schema, migration, account, user, session, worker]. Root cause confirmed outside code: Cloudflare D1 database code-nest-dev-db returns error 7429, D1 DB is overloaded, Requests queued for too long, even for SELECT 1. Worker traffic is low, about 64 requests in the last hour, so no code change or retry loop added. Auth.js getUserByAccount and favicon short-link lookup both fail because all D1 reads fail.

## Source Nodes

- auth.ts
- schema.ts
- Database