# Member links directions

Status: proposed, Human Gate 2 pending
Date: 2026-09-28

| Direction | Structure and mobile behavior | Evidence | Cost and risk |
| --- | --- | --- | --- |
| A. Focused polish (recommended) | Keep desktop table. Render compact mobile link rows with URL, destination, clicks, visible Copy and QR. Keep edit/delete in detail. Shorten header and collapse QR customization. Show useful zero-state statistics. | L01, L02; beta audit 1-5 | Smallest behavior-preserving change; two responsive presentations must stay consistent. |
| B. Task-first workspace | Use the same link rows on every width, with create, search, and filters above. Open a focused detail sheet for copy, QR, stats, then edit. | L01, L02 | Larger layout change; needs more keyboard and density review. |
| C. Analytics console | Keep dense table and promote trends, owner, tags, and metrics in a persistent side panel. | Beta stats depth | Better for power users; likely too dense for the member-first brief and mobile. |

Recommendation: A. Keep the approved links behavior and CODE visual system. Prototype desktop list, mobile list, and mobile detail before production edits.
