---
version: 1
slug: "src-app-portal-retention"
primary_target: "src/app/portal/retention"
related_targets: ["src/components/retention-parts.tsx","src/components/retention-history.tsx"]
---

# Member retention

Mode: Operate. A member opens this to answer one question: am I retained this school year, and if not, what do I still need and by when. Retention is 8 parts (4 yearly, 4 per semester), 1 point per slot, 12 slots a year; overflow never counts; events with a feedback form pay 75% at check-in and 25% on answering. Replaces the 2026-10 term-points page (src-app-portal-events brief), whose term goal, stat tiles and charts are retired.

## Direction contract

THESIS: The school year as a report card. Two semester columns; each part is a row; a yearly part's cell spans both columns, a semestral part gets one cell per semester. Refuses the uniform list of progress bars and the big ring.

OWN-WORLD: CODE navy and blue tokens, Unna for the page and group headings only, Source Sans for every label and figure (tabular numerals). Met cells fill navy with a drawn check; pending shares are a hatched pale-blue segment; overflow is a dashed chip that reads "not counted"; missed cells go flat with an x. No red or green: state is carried by fill, icon and words.

STORY: See the verdict and next deadline, unlock pending feedback shares, scan the grid for open cells, see what does not count, then check milestones and history.

FIRST VIEWPORT: Title and school-year picker; a one-line verdict ("On track. 5 of 12 met.") with a 12-cell slot strip and the next deadline naming its parts; the pending-feedback panel when any; the grid's column heads with each semester's dates, then the first rows.

FORM: Semester timeline grid, rank 3 of 7 on my list, dealt lead. Seed key dc53a3ee. Code-led (no image generation).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Research

- [SchoolAI outcomes](https://mobbin.com/screens/2b147162-dcec-40bf-8f1b-42864f4ccba2): one segmented bar per outcome, counts inside segments.
- [Zoom whiteboard gantt](https://mobbin.com/screens/15aa9a9d-61bb-416e-b9d0-ea0d0e8f08ee): time columns with spans that cross them.
- [Codecademy path curriculum](https://mobbin.com/screens/63e05256-8dd3-4758-9abd-bc84176be27d): grouped requirements with a small per-item progress mark.

Mobile: the grid keeps two semester columns down to 320px; the part label moves above its cells. Yearly cells span both columns. Every cell states its value in words as well as fill.
