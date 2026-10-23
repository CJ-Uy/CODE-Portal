---
version: 1
slug: "src-app-portal-gallery"
primary_target: "src/app/portal/gallery"
related_targets: ["src/components/gallery","src/app/gallery"]
---

# Gallery surface

Scope: `/portal/gallery` (folders, photo and video timeline, lightbox, upload, select, Recently deleted) and the read-only public view at `/gallery`. Visitor mode: Experience. The photos lead; chrome recedes.

Audience and job: CODE members after an event, mostly on phones, dropping photos in and finding them later. Anyone can upload, edit, move and delete; deletes are recoverable for 30 days by the deleter or a photo gallery admin. Uploader is always recorded and shown.

Constraints: established CODE world (navy, light blue, Unna headings, Source Sans). Server-enforced permissions. Public view shows no member names.

## Direction contract

THESIS: A folder reads as a dated roll of film: square tiles packed edge to edge under day headers that stick while you scroll, with subfolders as a cover strip above. Refuses the card grid of thumbnails with filenames and the Drive-style file table.

OWN-WORLD: White photo field in light mode, CODE navy (#06192F) field in dark; 2px gutters, no tile radius; day headers in Unna with a quiet Source Sans count; light blue (#D7DFE9) selection wash with navy check discs; lightbox on navy at 96% with white Source Sans; folder covers 4:3 with name and count beneath.

STORY: Open the gallery, see folders as covers, step in, scroll by day, tap a photo to fill the screen, swipe or arrow through it, read who uploaded it, edit or move it. Upload is always one tap away. Select turns tiles into a checklist with a floating action bar. Recently deleted is the same roll, grouped by days left instead of the day taken.

FIRST VIEWPORT: Breadcrumbs and folder name (Unna) top left; Upload (primary), New folder, Select and a Recently deleted link top right, wrapping on mobile. Folder cover strip, horizontally scrollable. Then the first sticky day header and the grid: 6 columns desktop, 3 at 390px.

FORM: Timeline grouped by day, candidate 3 of 7, seed key 63eea958.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: tile to lightbox with keyboard (arrows, Esc, i for info) and swipe, neighbours preloaded. Motion: a short fade-scale on open, nothing on scroll; reduced motion removes it.
