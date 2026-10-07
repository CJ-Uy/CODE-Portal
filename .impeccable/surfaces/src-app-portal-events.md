---
version: 1
slug: "src-app-portal-events"
primary_target: "src/app/portal/events"
related_targets: ["src/components/retention-history.tsx", "src/components/retention-category-progress.tsx"]
---

# Member retention

Mode: Operate. Members check this term's points, understand their category contributions, and find the activities behind them. Extend the current portal with real ledger data. Category attendance minimums are not configured; use the existing term points goal.

## Direction contract

THESIS: A progress report connected to its activity history. One chart switcher keeps category views together.

OWN-WORLD: Inherit CODE's navy, Unna headings, Source Sans labels, shallow bordered surfaces and existing event category color tokens. Color identifies a category consistently in the chart and history; labels carry the meaning too.

STORY: Check the target, compare category contributions, replay recorded progress, then inspect dates, activities, categories and points.

FIRST VIEWPORT: Preserve the term summary, put the category chart immediately below it, and keep compact metrics nearby. The three chart controls wrap on phones. The history uses a divided table on desktop and stacked rows on mobile.

FORM: A local extension of the established member workspace, pinned by the two supplied report references. No concept seed applies. Pie, Progress and Bar race share Points and Activities controls. Playback begins only on request and respects reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Research

- [ClickUp dashboard](https://mobbin.com/screens/2802e4dc-5a33-4b61-b556-7008bffeeb2f): adjacent chart formats with visible labels and category legends.
- [15Five goals](https://mobbin.com/screens/ea5eabaa-97ff-45ec-9cb0-19ea2503bfff): target summary with a readable donut and statuses.
- [Fibery activity log](https://mobbin.com/screens/96626867-28de-4fa1-b7ec-4fb2d2e4510c): compact divided records and contextual filters.

Keep negative and null-point records visible. Count distinct attended events, including attendance worth zero points. Never infer category requirements from a sample image.
