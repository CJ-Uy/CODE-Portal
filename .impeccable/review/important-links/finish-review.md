# Important links finish review

Surface: `/portal/important-links` and `/portal/admin/content/important-links`. Direction contract: `.impeccable/surfaces/src-app-portal-important-links.md`. Code-led, Operate mode. The concept roll was skipped: the request fixed the structure (grouped categories, title, description, type, new tab) and the surface extends an established world, so there is no seed key.

Round 1 disposition: fix. Material fixes: block non-web URLs in the browser (`pattern`), remove the bordered box around Show in sidebar (nested container), keep the member intro on one line at 1440 (`max-w-3xl text-pretty`), render the editor meta line inline like the member page, singular "link" in the archived category count. The "1 Issue" dev overlay came from a test script setting `details.open` before hydration and does not occur with a real click.

Round 2 verdict: five fixes resolved, the meta line partial because the host split mid-word at 390. Fixed by using `[overflow-wrap:anywhere]` instead of `break-all` on the host in both pages; the recapture shows `ateneo0.sharepoint.com` moving to the next line whole.

Measured: `scrollWidth` equals 390 on both pages at 390, with every editor disclosure open. Detector: no findings. Create, reorder, archive and the Archived list were exercised in a local signed-in preview.

DESIGN.md: the member rail paragraph and a new Important links section were updated by hand from the built pages (ordinary extension, no token change), so no documenter run.

Captures (not committed): `.impeccable/review/important-links/*.jpg`.
