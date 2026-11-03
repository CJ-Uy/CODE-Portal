# Important links finish review

Surface: `/portal/important-links` and `/portal/admin/content/important-links`. Direction contract: `.impeccable/surfaces/src-app-portal-important-links.md`. Code-led, Operate mode. The concept roll was skipped: the request fixed the structure (grouped categories, title, description, type, new tab) and the surface extends an established world, so there is no seed key.

Round 1 disposition: fix. Material fixes: block non-web URLs in the browser (`pattern`), remove the bordered box around Show in sidebar (nested container), keep the member intro on one line at 1440 (`max-w-3xl text-pretty`), render the editor meta line inline like the member page, singular "link" in the archived category count. The "1 Issue" dev overlay came from a test script setting `details.open` before hydration and does not occur with a real click.

Round 2 verdict: five fixes resolved, the meta line partial because the host split mid-word at 390. Fixed by using `[overflow-wrap:anywhere]` instead of `break-all` on the host in both pages; the recapture shows `ateneo0.sharepoint.com` moving to the next line whole.

Measured: `scrollWidth` equals 390 on both pages at 390, with every editor disclosure open. Detector: no findings. Create, reorder, archive and the Archived list were exercised in a local signed-in preview.

DESIGN.md: the member rail paragraph and a new Important links section were updated by hand from the built pages (ordinary extension, no token change), so no documenter run.

Captures (not committed): `.impeccable/review/important-links/*.jpg`.

## Polish pass (2026-10-23, afternoon)

Added search (from six links), a copy button per link with a toast and an in-app-browser fallback, a New pill for links from the last two weeks, a sidebar-pin count in the editor, and shorter copy on both pages.

Round 1 disposition: fix. Six items: keep the copy-failure toast up for 6 seconds, carry the row hover tint behind the copy button, replace the browser's search cancel glyph with an in-field Clear search button, quote the query in the no-match heading, sit the count beside the field, and match the New pill to the editor badge. A shell-wide "PORTAL" kicker above page titles was noted as out of scope (portal-shell.tsx).

Round 2 verdict: five resolved, one partial (the empty-state Clear search did not return focus to the field). Fixed by routing both clear buttons through one handler that refocuses the input.
