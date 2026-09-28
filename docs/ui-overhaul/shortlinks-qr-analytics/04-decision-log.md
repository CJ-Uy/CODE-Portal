# Shortlinks QR and Analytics Decision Log

## Approved direction

- Status: approved
- Direction: Incremental task-first links workspace with QR composition B. Keep the current table and dialogs, place the QR preview beside controls on desktop and above them on mobile, and keep analytics report-first with advanced filters progressively disclosed.
- Approved screenshot/prototype ID: `ARSA-QR-INTEGRATED-DESKTOP`, `ARSA-QR-INTEGRATED-MOBILE`
- Mobbin evidence IDs: M01, M02, M03, M04, M05
- Keep: CODE navigation and branding, member visibility and creation, owner/moderator authority, saved QR styles, public root slugs, social previews, sharing, fullscreen, search, sorting, tags, owners, and existing aggregate history.
- Change: Keyboard and nested-control behavior, QR pattern and logo controls, exact-output scan gates, canonical attribution, consistent analytics filtering, loading/error/empty states, and visible query limits.
- Reject: ARSA branding or configuration, a separate subsystem, admin-only access, unsupported referrer/bot claims, unverified scan assumptions, silent truncation, and production operations.
- Approved by: human
- Date: 2026-09-16
- Human Gate 2: approved direction
- Human Gate 3: approved reference composition through the pinned desktop and mobile images

## Human comments

| Screen ID | Element | Keep / change / question | Comment | Resolution |
| --- | --- | --- | --- | --- |
| `SHORTLINKS-WORKSPACE` | Existing shortener | Change | So i just  upgraded a project called arsa-website with a better link shortener or redirects admin page ui ux by building ontop of the one used here so can you use the findings it has i uploaded here to upgrade the current link shortener as well ? | Use the uploaded ARSA evidence as behavioral reference and adapt it to CODE. |
| `ARSA-QR-INTEGRATED-DESKTOP` | QR composition | Keep | The desired QR composition is **B: preview beside controls on desktop, stacked on mobile**. | Treat composition B as approved visual direction. |
| `SHORTLINKS-ANALYTICS` | Reporting hierarchy | Change | Analytics should be report-first, with advanced filters progressively disclosed. | Keep report identity and results visible; disclose advanced query controls on demand. |

## Evidence status

- The frozen ARSA desktop/mobile images are implementation references, not evidence of CODE deployment or physical-camera testing.
- No independent Claude audit was performed, so no `01-claude-audit.md` is claimed.

## Deviations

| Date | Slice | Deviation | Reason | Human approval |
| --- | --- | --- | --- | --- |
| 2026-09-16 | Shortlinks QR and analytics | Use the approved ARSA screenshots instead of creating a separate CODE mockup before implementation. | The human supplied the pinned implementation and acceptance record and explicitly selected composition B. | approved |
