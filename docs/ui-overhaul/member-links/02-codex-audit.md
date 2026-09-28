# Member links audit

Status: observed; design pending
Date: 2026-09-28
Surface: authenticated beta, `/portal/links`, desktop default and 390 x 844 mobile.

1. **Mobile priority:** table measures 1037 px inside a 341 px scroll area. Page itself has no horizontal overflow, but copy, QR, delete, clicks, and owner sit offscreen. After closing detail, focus scrolls the table to actions and hides titles. A stacked mobile row can show the short URL and primary actions together.
2. **Filter count:** `My links` displays one row while footer still says “Showing all 2 links.” An unmatched search says “No links match these filters” beside the same footer. Footer should report visible and loaded totals and offer Clear filters.
3. **Detail hierarchy:** long destinations wrap across the mobile dialog header. QR customization opens with pattern, corner, logo, backing, and color controls before edit actions; on mobile the QR itself consumes the first screen. Lead with short URL, copy, QR preview and download; collapse advanced settings.
4. **Statistics:** beta example has 9 lifetime clicks but 0 in the default Aug 30 to Sep 28 range. A full-height zero chart and six metric tiles dominate the view. A plain no-activity-in-range state and visible lifetime total would explain this faster. “0 of 5,000 allowed hourly aggregate rows” is implementation language for members.
5. **Create:** form fits mobile width and has labeled fields. The hostname is repeated in prefix and help copy; destination comes after slug even though it is the starting input for most users. Simplify copy and test destination-first ordering in a prototype.

Working: public home, portal overview, link list, create dialog, detail tabs, QR rendering and scan check, and statistics load. Search and `My links` respond. Browser body did not overflow at 390 px. Create/edit/delete were not submitted during this read-only audit.

Feasibility: `LinksWorkspace` owns list state, sorting, search, dialog, and count. `LinkQrCustomizer` owns QR controls. The feature worktree already handles copy failures and exposes pagination, so the first slice can stay in UI files. Preserve `slug`, `destinationUrl`, `title`, `tags`, `qrStyle`, `scope`, link IDs, and stats query parameters. Graph index is dated 2026-09-15; current feature source and beta UI were read directly. No independent Claude audit was available in this session.

Protected behavior before production edits: create inputs are `slug`, `destinationUrl`, `title`, and optional `tags`; edit also carries preview fields and `qrStyle`. List paging uses `limit` and `offset`; the row's public target is `/<slug>`. Statistics use `from`, `to`, `timezone`, `granularity` (`hour`, `day`, `week`, `month`), `source` (`all`, `qr`, `link`, `unknown`), and `device` (`all`, `mobile`, `desktop`). QR traffic uses `?source=qr`. Preserve link IDs, ownership/moderator checks, click totals, referrer/device bucket tokens, and the existing API responses.
