# Cloudflare Resources

Project slug: `code-nest`

Production bindings live at the top level of `wrangler.jsonc`. Beta remains the explicit `dev` environment for shared development compatibility. Staged is a production-behavior Worker with isolated storage.

## D1

| Purpose | Name | Binding | Database ID |
| --- | --- | --- | --- |
| Shared/dev | `code-nest-dev-db` | `DB` | `f9d2b16f-3358-49c2-a88e-e72c9339a22b` |
| Staged | `code-nest-staged-db` | `DB` | `18b0f067-101b-4aac-b724-6382a7d3cdd0` |
| Production | `code-nest-prod-db` | `DB` | `a66fac5e-c122-466d-b7fe-5910ba6a98b9` |

## R2

| Purpose | Name | Binding |
| --- | --- | --- |
| Shared/dev | `code-nest-dev-uploads` | `BUCKET` |
| Staged | `code-nest-staged-uploads` | `BUCKET` |
| Production | `code-nest-prod-uploads` | `BUCKET` |

## Safety

- Dev resources are safe for shared development workflows.
- Staged resources are isolated from beta and production.
- Production resources are production-only.
- Outside developers should not receive D1 credentials or Cloudflare account access.
- R2 S3 credentials, if issued, must target dev workflows only.
