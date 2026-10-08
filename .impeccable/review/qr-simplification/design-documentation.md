# QR simplification documentation

Completed 2026-10-08. Ordinary local extension following the user's approved QR placement. No replacement visual world or durable system change was approved.

## Incumbent comparison

| Surface | Finished behavior and evidence | System retained |
| --- | --- | --- |
| Home | `src/app/portal/page.tsx:73` places Upcoming events first and line 93 places Retention path before the metric row. They stack on mobile and pair on desktop. The complete current Home source has no member QR. | Plain Home heading, Manila dates, approved-event paging, existing retention data, house Cards, Calendar button and lucide icons. |
| Plus sheet | `plus-mobile.png` shows the expanded Event check-in QR before Create event and New short link. | Existing shell, automatically expanded QR, shared renderer and four bottom destinations. The correction does not change these components. |
| Profile | `src/app/portal/profile/page.tsx:118` uses a native closed-by-default details disclosure. Its summary reuses outline `buttonVariants`, a 44 px minimum height and lucide icons. Show check-in code becomes Hide check-in code when open; line 125 renders the existing MemberCodeCard. | Existing profile information, points, editing form, shared branded QR and house control styling. Native disclosure supplies the opening and closing behavior. |

Compared PRODUCT.md, DESIGN.md, the current Home/Profile source and `.impeccable/surfaces/src-app-portal.md`. The finished views preserve CODE's navy shell, neutral ground, white shallow surfaces, Unna headings and Source Sans body and controls. No global tokens, fonts or reusable primitives were introduced.

The surface brief already records the approved Home order, QR-free Home, ready QR in the plus sheet and compact native Profile disclosure. It required no documenter edit. Earlier check-in-first Home documentation describes the preceding iteration; this report and the current brief record the superseding approved direction.

## Evidence and completion

Opened all eight current captures: `home-mobile.png`, `home-desktop.png`, `home-user-320.png`, `plus-mobile.png`, `profile-closed-mobile.png`, `profile-closed-desktop.png`, `profile-open-mobile.png` and `profile-open-desktop.png`. They show the named surfaces and disclosure states without malformed regions. These PNGs are review evidence; no new shipping raster was introduced.

Read `finish-review.md`: disposition **ship**, no material fixes, with all five contract sections. Its separate fallback reviewer and missing separate QUALITY BAR card are disclosed in that report; no approved comp or concept seed applies to this extension.

The build owner reports six initial browser tests passed, followed by four strengthened Home/Profile checks passing on the compiled app in Chromium and WebKit: touchscreen taps and Enter/Space toggle the disclosure, DPR 3 keeps the QR at 220 px, 320/390/1440 px layouts have no horizontal overflow, and retention precedes metrics. Plus-menu checks also passed in both browsers. Production build exited 0; lint has zero errors and two pre-existing warnings. These results were not rerun by this documenter. Real iPhone scanning and assistive-technology behavior remain outside the supplied browser evidence.

## Preservation and drift

Only `.impeccable/review/qr-simplification/design-documentation.md` was written by this handoff. No source, brief, global design, product, configuration or graph file was edited.

DESIGN.md retains its existing missing token frontmatter, noncanonical sections and stale demo/authentication wording. The previously reported configuration drift is untouched. `.impeccable/design.json` was absent and remains absent. No global documentation repair was authorized by this ordinary extension.

Tier 2 coverage for `code-nest` generation `2026-09-15T06:37:48Z` reports changed metadata for Home and Profile. Complete current source reads govern this comparison; no graph-completeness claim is made.

DESIGN.md SHA-256 before and after documentation is identical: `610c13e21ded0361a159a4e7427361a5ca8dbe733b22ad54fb59582c9e28ae13`. Documentation is complete for the finished correction. Recheck if the reviewed source changes.
