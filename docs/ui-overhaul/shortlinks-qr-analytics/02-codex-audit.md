# Shortlinks QR and Analytics Codex Audit

Status: complete
Date: 2026-09-16

## Decision

Extend the existing links workspace, QR components, repository, and contracts as one bounded upgrade. The current data model already stores saved QR JSON and joint daily/hourly source-device aggregates, so a second subsystem and schema migration are unnecessary.

## Findings

1. **Useful foundation:** Search, sorting, tags, owners, creation, editing, moderation, sharing, previews, fullscreen QR, charts, and saved QR JSON already exist and should be retained.
2. **Incomplete inventory:** The portal loads 50 links and then filters and sorts in the client. The ceiling is silent, so the visible inventory can be incomplete.
3. **Interaction access:** Row opening is pointer-only and nested controls can conflict with the row action. The title needs a semantic button, non-interactive row space may open Details, and child/portaled controls must stay isolated. Several targets are below 44px.
4. **QR consistency:** Current PNG and SVG paths do not guarantee the same final logo artwork. Pattern, corner, logo visibility/backing, size, background, and export-size controls are incomplete. Draft initialization can carry settings between links, and fullscreen needs reliable Escape and focus return.
5. **QR safety:** H correction is already used, but there is no exact final-output decode gate. PNG and rasterized SVG need full-size and 256px checks, with pending or failed checks blocking every download and stale async results discarded.
6. **Analytics scope:** Date range affects only part of the report, breakdowns remain unfiltered, average labels are dimensionally unclear, and loading is a text placeholder. One validated server-side query must drive metrics, trend, and breakdowns, preserve zero buckets, disclose history limits, and provide stable skeleton, error, retry, and empty states.
7. **Attribution path:** Redirects recognize only legacy `s=qr`; crawler previews are counted before the preview response. Shared and internal adapters can drop request query strings. Canonical `source=qr` needs documented precedence, legacy support, query preservation, and no destination leakage or double counting.
8. **Authorization boundary:** Link mutations enforce stored ownership or `link:moderate`, but related upload paths must use the same server-authoritative check. Shared-dev remains read-only for mutations. Contract/internal changes require a beta Worker redeploy later, but none is authorized in this slice.

## Protected contracts

- Form fields: `slug`, `destinationUrl`, `title`, `tags`, `previewTitle`, and `previewDescription`.
- Routes/table links: `/portal/links`, `/portal/links/[id]`, and public `/<slug>` redirects.
- Query markers: one canonical `source=qr` wins when present; otherwise one legacy `s=qr` is accepted. Duplicate, conflicting, or invalid markers classify as Link. Plain copied URLs stay untagged.
- QR contract: error correction H, quiet space, official logo proportions/colors, saved per-link style, PNG and SVG export.
- Analytics buckets: stored `qr scan` and `direct` values remain protected; the UI may label them as QR and Link. Missing history remains unknown.
- Permissions: owner, `link:moderate`, super inheritance, authenticated member read/create access, and shared-dev read-only behavior.
- Link status values: no short-link status enum exists in this slice; do not invent one. Event and attendance QR codes are outside scope.

## Implementation recommendation

Use the current native date inputs, UI primitives, decoder, repositories, and aggregate tables first. Add only the QR rendering capability the six requested patterns require. Keep advanced analytics filters progressively disclosed and show the applied scope beside the report.
