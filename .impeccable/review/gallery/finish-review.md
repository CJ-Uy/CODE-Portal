# Gallery finish review

Surface: `/portal/gallery`, `/portal/gallery/deleted`, `/portal/gallery/event/[eventId]`, the event page Photos row, and the public `/gallery`. Code-led build inside the established CODE world; no comp. Direction contract in `.impeccable/surfaces/src-app-portal-gallery.md` (seed `63eea958`, timeline grouped by day).

## Rounds

1. Full review: disposition **fix**. Fidelity matched the contract (edge-to-edge square roll, sticky Unna day headers, cover strip, selection wash, navy lightbox, Recently deleted grouped by days left). Five material fixes:
   1. Lightbox actions gave no visible feedback: page toasts paint under the Radix dialog.
   2. Event page Photos row showed a blank tile for a video without a poster.
   3. Arrow keys in the lightbox stole seeking from a focused video.
   4. Upload scrolled out of reach on phones.
   5. Recently deleted used a bare trash icon on phones, reading as "delete this folder".
   Ceiling note: the public navy band was tall enough to push photos below the first viewport.
2. Verdict pass: all five fixes and the public band scored **resolved**, disposition **ship**. Noted, not material: on phones the floating Upload sits near the portal's centre plus, and a page toast briefly overlaps it.

## Fixes as built

- `Lightbox` takes a `notice` rendered inside the dialog; `GalleryBrowser.announce()` routes results there while the viewer is open, and moving or deleting the open photo steps to its neighbour first.
- `EventPhotos` is a client component with the roll's fallback tile and video strip.
- The lightbox key handler ignores INPUT, TEXTAREA, SELECT and VIDEO targets.
- A round Upload button appears on phones once the toolbar Upload leaves the viewport (IntersectionObserver), hidden while selecting or uploading.
- Recently deleted uses `ArchiveRestore` at every size.
- Public band padding reduced; public sticky offsets set to the measured header (155px phone, 99px from md).

## Evidence

Screenshots were captured from a local signed-in preview with synthetic landscape images: `desktop.png`, `desktop-lightbox.png`, `desktop-deleted.png`, `desktop-public.png`, `desktop-event.png`, `mobile.png`, `mobile-scrolled.png`, `mobile-lightbox.png`, `mobile-deleted.png`. They are not committed. The detector (`impeccable detect --json`) returned no findings on the gallery files.
