---
version: 1
slug: src-app-portal
primary_target: src/app/portal/page.tsx
related_targets: [src/app/portal/profile/page.tsx, src/components/portal/portal-shell.tsx, src/components/member-code-card.tsx]
mode: Operate
---

# Member home

THESIS: Home shows the next approved events and retention progress. The plus sheet is the primary place to show an event host the member code.

OWN-WORLD: Extend the established CODE member workspace. Keep navy, white, Unna headings, Source Sans body, and existing house controls. Preserve the automatically expanded check-in code in the plus sheet.

STORY: Upcoming events and retention progress come first, then existing points, announcements and library content. Dates and titles come from approved events. Empty calendars point to Calendar without inventing activity. Profile offers a compact Show check-in code disclosure instead of repeating an expanded QR.

FIRST VIEWPORT: Mobile opens on upcoming events, followed by retention progress. Desktop pairs the two. Keep the date below Home, no eyebrow above the heading. Opening the plus sheet immediately shows the expanded check-in code.

FORM: Local extension of the existing workspace. No replacement visual world or concept seed is required.

Completed behavior: Home and event dates use Manila time. Show up to three approved events that are current or upcoming, continuing through later repository pages when archived events fill the first page. Home has no member QR. Profile's native disclosure starts closed and supports touch and keyboard opening and closing. The shared QR stays at its 220 px display size, with a higher-resolution backing canvas on high-DPI devices.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Research

Mobbin deep research inspected seven iOS screens. UNIQLO membership puts the usable pass first: https://mobbin.com/screens/7fd1092d-4f2a-4133-a245-6c4b938f392d. Open groups the pass and booked activities: https://mobbin.com/screens/48fd0a8a-f5e6-4f3f-8805-48413d46bb01. Keep the pass ready in the plus sheet and preserve CODE's typography and palette. The user's subsequent approved direction removes the repeated Home code and collapses it on Profile.
