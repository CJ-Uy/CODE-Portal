---
version: 1
slug: src-app-portal
primary_target: src/app/portal/page.tsx
related_targets: [src/components/member-code-card.tsx, src/components/qr-canvas.tsx]
mode: Operate
---

# Member home

THESIS: Open Home to show an event host the member code, then see the next approved events. Replace the personal greeting with a plain Home heading.

OWN-WORLD: Extend the established CODE member workspace. Keep navy, white, Unna headings, Source Sans body, and existing house controls. Preserve the automatically expanded check-in code in the plus sheet.

STORY: Check-in comes first, upcoming events second, then existing points, announcements and library content. Dates and titles come from approved events. Empty calendars point to Calendar without inventing activity.

FIRST VIEWPORT: Mobile opens on the check-in code. Desktop pairs it with the event list. Keep the date below Home, no eyebrow above the heading.

FORM: Local extension of the existing workspace. No replacement visual world or concept seed is required.

Completed behavior: Home and event dates use Manila time. Show up to three approved events that are current or upcoming, continuing through later repository pages when archived events fill the first page. Keep check-in before the existing dashboard content. The QR stays at its 220 px display size before and after rendering, with a higher-resolution backing canvas on high-DPI devices.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Research

Mobbin deep research inspected seven iOS screens. UNIQLO membership puts the usable pass first: https://mobbin.com/screens/7fd1092d-4f2a-4133-a245-6c4b938f392d. Open groups the pass and booked activities: https://mobbin.com/screens/48fd0a8a-f5e6-4f3f-8805-48413d46bb01. Borrow that task order, preserve CODE's typography and palette.
