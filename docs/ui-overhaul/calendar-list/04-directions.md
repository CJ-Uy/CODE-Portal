# Calendar list directions

Status: proposed, Human Gate 2 pending
Date: 2026-09-28

| Direction | Structure and mobile behavior | Evidence | Cost and risk |
| --- | --- | --- | --- |
| A. Date sections (recommended) | Show Today, Upcoming, then Past with dates and role badges. Today and Upcoming ascend; Past descends. Keep the current compact event row, add clear empty states and a time-aware fetch. | C01, C02; beta audit 1-2 | Small UI change; data loading needs a safe bound. |
| B. Agenda timeline | One chronological rail with a Today divider and a Past switch. Put next event first on opening List. | C01, C02, C03 | More visual change, stronger date context; needs mobile timeline testing. |
| C. Operations list | Add event type, role, and status filters above a dense list. | Beta role metadata | Useful for admins; too much control for routine member browsing. |

Recommendation: A. Interpret “past, today, upcoming” as three groups, with actionable dates first. If the user wants Past first, record that ordering in the decision log before prototyping. Check the 50-event cap in the same implementation slice.
