---
version: 2
slug: "src-app-portal-gallery"
primary_target: "src/app/portal/gallery"
related_targets: ["src/components/gallery","src/app/gallery"]
---

# Gallery surface

Scope: `/portal/gallery` (front page, albums, scrapbook and grid views, lightbox, upload, select, browse and search, Recently deleted), the event page Photos row, and the read-only public view at `/gallery`. Visitor mode: Experience. The photos lead; chrome recedes.

Audience and job: CODE members after an event, mostly on phones. Two jobs dominate: add photos from an event, or find one fast. Browsing should feel like flipping a scrapbook, not clicking through a file grid. Anyone can upload, edit, tag, move and delete; deletes are recoverable for 30 days. Uploader is always recorded and shown.

Constraints: established CODE world (navy, light blue, Unna headings, Source Sans). Warm and made with care, cute but not quirky. No walls of text. Server-enforced permissions. Public view shows no member names.

## Direction contract

THESIS: An album reads as a scrapbook: prints at their own shape on white mats with small fixed tilts, captions in Unna italic under them, a day's prints gathered under its date. The dense square roll stays as the Grid view for scanning and selecting. The front page leads with recent events and keeps old ones in a folded archive. Refuses the Drive-style file grid as the default way in.

OWN-WORLD: Light photo field; prints on white mats with soft offset shadows, tilts no larger than 1.2 degrees, flattening on hover and focus; captions in Unna italic slate; hearts in navy; day and section headers in Unna with quiet Source Sans counts; light blue selection wash with navy check discs in Grid; lightbox on navy with white Source Sans; album covers 4:3, an empty album's cover a dashed "Add photos" invitation.

STORY: Open the gallery, tap Add photos, pick the event (recent first), choose photos: two taps. Or search a name, event or caption, or open a recent event. Inside an album, scroll the scrapbook, open a print, heart it, tag who is in it. Older events sit in the archive by school year. Recently deleted is the grid grouped by days left.

FIRST VIEWPORT: Front page: Gallery title with Add photos (primary) and a quiet Recently deleted icon; a full-width search field; browse chips (Photos of you, Most loved, Most viewed, Most tagged, All photos); Recent events as large covers. Album page: breadcrumbs, album name, Add photos, New album, a Scrapbook/Grid toggle, Select and album settings in one row on phones; then the first day's scrapbook page.

FORM: Timeline grouped by day, candidate 3 of 7, seed key 63eea958 (extended with the scrapbook view on CJ's request, 2026-10-23).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: print or tile to lightbox with keyboard (arrows, Esc, I for details) and swipe, neighbours preloaded; heart with an instant count. Motion: a short fade-scale on open, prints settle flat on hover; reduced motion removes both.
