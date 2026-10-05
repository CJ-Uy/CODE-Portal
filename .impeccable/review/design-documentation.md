# Design documentation check

Date: 2026-10-05

Scope: the final admin directory, navigation, breadcrumbs and mobile menu, plus the Ments and email extensions. This is an extension of the pinned CODE system. The write adds only `DESIGN.md`'s Admin workspace section and this evidence record. Palette, typography, incumbent sections and tokens are preserved; no sidecar is created.

Git tracks the existing contract as lowercase `design.md`; `DESIGN.md` resolves to the same file on this Windows checkout. Its name was preserved.

## Evidence checked

- Read the Impeccable documenter role and `reference/document.md`, `PRODUCT.md`, `DESIGN.md`, and the admin, Ments and email surface direction contracts.
- Read `src/app/globals.css` and `src/components/ui/button.tsx`: the established CODE palette, Unna heading family, Source Sans body family, focus treatment and existing UI variants remain the source of truth.
- Read `src/components/portal/portal-shell.tsx`, `admin-navigation.tsx`, `admin-tools.tsx`, `breadcrumb.tsx`, `src/app/portal/admin/nav.ts` and `page.tsx`: grouped disclosures, permission and feature filtering, linked ancestry, divided task rows, responsive directory and mobile sheet are implemented.
- Read `src/app/portal/ments/ments-tree.tsx`, `pments-editor.tsx`, and `src/app/portal/admin/members/ments/page.tsx`: full forest canvas, solid/dashed connection distinction, person controls, fit and zoom, statistics, direct Pment reporting and the scoped admin editing entry are implemented.
- Read `src/app/portal/admin/email/personalization.tsx`, `composer.tsx`, `templates/page.tsx` and `src/lib/email/starters.ts`: eight editable built-in starters, preview gallery, actual receiving-audience rows, missing-field filter, pagination, recipient rendering and draft override payloads are implemented.
- Visually inspected `desktop.png`, `mobile.png`, `user-1265.png`, `templates-desktop.png`, `templates-mobile.png`, `personalization-desktop.png`, `personalization-mobile.png`, `ments-desktop.png`, `ments-mobile.png` and `ments-statistics-mobile.png` in this review directory. The evidence shows the CODE rail, wrapping mobile directory, template gallery, corrected recipient values, forest canvas and mobile statistics. Most captures are viewports; the reported full-page browser capture failure limits screenshot coverage. Source reads support behavior outside the captured regions.

## Graph evidence and limits

Tier 2, project `code-nest`, primary checkout `C:/Users/charl/Documents/GitHub/code nest`, coverage generation `2026-09-15T06:37:48Z`. `list_projects` and `index_status` confirmed the project. The symbol search returned the older `PortalShell`; pagination was complete. A graphify query for the admin, Ments and email organization returned only broad, unrelated nodes, so it did not support the new surface claims.

`check_index_coverage` covered every source and document path relied on above. The global stylesheet has recorded parse ranges 3-3 and 3-5; these lines and the stylesheet were read directly. Other paths have no recorded coverage issue, with freshness marked changed, untracked or missing. That is not evidence of completeness or freshness for this worktree. The current worktree source and supplied raster evidence ground this scoped documentation. This pass does not claim a new browser interaction test, dispatch verification or exhaustive application review.

The tracked lowercase contract path was checked separately after confirming its Git spelling. A final source and diff read confirmed that only the scoped section was added. `git diff --check` passed, with the checkout's LF-to-CRLF warning. No code changed, so this pass did not repeat the application's tests.

## Final correction recheck

The final four UI corrections were rechecked against targeted current source in `src/app/portal/ments/ments-tree.tsx`, `src/lib/ments.ts`, `src/app/portal/ments/page.tsx`, `src/components/portal/portal-shell.tsx` and `src/app/portal/admin/email/composer.tsx`. The Ments graph search returned no match, with pagination complete. Coverage for these paths reports no recorded gaps but untracked or changed metadata against the same primary generation; direct worktree source is the evidence.

Inspected the fresh `ments-focused-mobile.png`, `ments-mobile.png` and `email-review-mobile.png` captures (390 by 844), plus `ments-focused-desktop.png` and `ments-desktop.png` (1440 by 1000). These are viewport captures. They show readable person names and cohorts in the focused canvas, wrapped fit and zoom control groups on mobile, ordinary word wrapping in the email confirmation, and a Ments utility heading without the PORTAL eyebrow.

The source uses 20px person names, 18px cohort labels, 80px nodes and 88px rows; these are local canvas implementation details, not new global type or spacing tokens. The confirmation uses `overflow-wrap: anywhere` to accommodate long values. Documentation adds only the observed grouped control wrapping and confirmation wrapping to the existing scoped section. Other sections and tokens remain unchanged; the finish reviewer's verdict is a separate check.

## Drift not repaired or canonized

The existing prototype and authentication statements in `DESIGN.md` are stale, and `.impeccable/design.json` is absent. Both were identified before this pass and remain outside the authorized documentation boundary. No token-system regeneration, format conversion or identity replacement was authorized. The scale of whole-forest nodes and template thumbnails is contextual presentation, not a new typography token. No defect or screenshot-specific value was promoted into a reusable system rule.
