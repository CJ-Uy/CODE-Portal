# Mobbin Reference Index

Status: complete
Inspected: 2026-09-16 through the official Mobbin connector

| ID | App / flow | URL or stable ID | Reusable pattern | CODE fit | Do not copy |
| --- | --- | --- | --- | --- | --- |
| M01 | Dub / Editing QR | https://mobbin.com/flows/1f8719d9-6dc1-424b-9a35-c9229e7de5b2 | Keep a large QR preview visible while controls change. | Immediate visual feedback fits the saved-style workflow. | Dub branding, color, spacing, and an assumption that preview equals scan safety. |
| M02 | Dub / Editing QR design | https://mobbin.com/flows/22382ac4-9bd9-4631-8e73-b60562b4b5cd | Make core appearance choices simple and progressively reveal secondary controls. | Keeps a capable editor understandable for members. | Third-party palette and shallow validation before export. |
| M03 | Linktree / Customizing QR | https://mobbin.com/flows/616aea9a-4d4c-4639-93be-59bc1b2aac15 | Pair direct customization controls with a persistent preview. | Supports composition B on desktop and a clear stacked order on mobile. | Linktree identity, marketing language, and decoration that weakens CODE logo rules. |
| M04 | Dub / Filtering analytics | https://mobbin.com/flows/7e84ecfc-4594-4173-932b-5d2b0d2b0b35 | Show filter state as explicit, removable scope rather than hidden modal state. | Members can tell which dates, source, device, timezone, and grouping produced the report. | Dense power-user controls shown by default. |
| M05 | Dub / Analytics | https://mobbin.com/flows/3f7fe303-78ab-42d6-8807-98ce761dc062 | Lead with report hierarchy, then expose advanced query controls. | Preserves quick comprehension while supporting deeper analysis. | Unsupported referrer or bot dimensions and Dub-specific product metrics. |

## Synthesis

- Repeated patterns: Persistent preview for QR work, a small set of primary controls, report-first analytics, and visible applied filter scope.
- Useful disagreements: QR editors favor immediacy while analytics flows favor progressive disclosure. CODE should keep QR feedback always visible and analytics complexity optional.
- Rejected trends: Third-party brand colors, decorative logo manipulation, invisible query state, and shallow scan assumptions.

These references inform hierarchy and interaction only. They do not prove QR scanability, permission safety, or CODE data availability.
