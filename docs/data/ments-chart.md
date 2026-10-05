# Ments chart snapshot

Source: [published mentor chart](https://docs.google.com/spreadsheets/u/1/d/e/2PACX-1vR3FrrsiQeHwI0520HBw2Q2063cNJxxipLJM-aqhat414y7Gvlbf7ukb1SzdoS8LXQgAxOfiIsKJTfY/pubchart?oid=759232815&format=interactive).

Read on 2026-10-05 from the chart's embedded `dataTable`, cross-checked against
the supplied screenshots. The TSV columns are person and their ments. Original
spelling and punctuation are retained. People who occur only as mentors become
branch roots.

The source contains 363 rows, including one blank mentee under
`NAVAL, Victoria Isabell`. The blank person is omitted. The chart owner confirmed
that this name refers to `NAVAL, Victoria Isabelle S.`, and that
`MATUTINA, Lorenzo S. Matutina` refers to `MATUTINA, Lorenzo S.`. The exporter
merges these two spelling variants while preserving the original TSV.

`pnpm exec tsx scripts/export-ments-chart.ts` validates the forest and creates
`.local/ments-chart-seed.sql`. This file is for beta only and is not part of the
shared migration history. It does not change existing profiles or infer portal
account links. Apply it only after the Wrangler command has been approved.
