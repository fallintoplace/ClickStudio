# Result exploration: V1 + V2

ClickStudio has two different ways to inspect data. They should not be confused.

## V1: retained SQL results

- Execute SQL normally. The configured row, byte, memory and time limits still apply.
- Click a result column header (or focus it and press Enter) to see **Column insights**.
- Insights read the retained result snapshot on demand. If unavailable, they show only the current page, labeled accordingly.
- Numeric histograms, null counts and popular values describe retained rows only, never an entire source table.
- Open **Search rows**, then **Select cells** to select a rectangle of cells using clicks and Shift-click. Copy exports only visible matching rows on the current page as tab-separated text. Detached large cells are copied as previews.
- Local search and paging operate on retained output, not on all source-table rows.
- Export retained rows and full-result CSV remain separate actions. Full-result CSV reruns the SQL and may see different data.

## V2: live table browsing

- In Object Explorer, select a ClickHouse table and choose **Browse table**.
- Choose a scalar column for sorting, ascending or descending.
- Optionally filter another scalar column by its exact string representation.
- Click **Apply** to query ClickHouse, or **Open as SQL** to edit the resulting statement.
- Pages contain at most 200 rows, with one extra row used to detect whether another page is available.
- The browser shows a window of up to 12 columns and lets you move horizontally through the column windows.
- Each page is an independent, read-only SQL query, with bounded time, memory and result bytes.
- Up to 25 pages are allowed for a browsing session. The public Playground does not expose this feature.

### Consistency and cost

Live table browsing uses ordered, bounded **LIMIT/OFFSET** queries. It is **not** a stable result snapshot:

- Duplicate values in the sort column may cause overlaps or omissions.
- Inserts, updates and deletes during browsing can change later pages.
- Sorting by a column not aligned with a ClickHouse table's sorting key can be expensive.
- Deep offsets are deliberately capped. There is no promise of infinite, gap-free browsing.
- Up to 500 source columns are supported. A single page is subject to a 2 MB output budget.
- Unsupported sort/filter types and inaccessible table metadata are rejected.
- All table/column identifiers are validated against system metadata, quoted, and filters are supplied as typed query parameters.

Ordinary SQL execution and its saved result history are not changed by this table-browsing feature.

## Implementation pointers

- Shared validation and SQL generation: \`src/shared/database/browse/table-browse.ts\`
- Local/Cloud database access: \`src/backend/database/clickhouse/table-browse.ts\`
- Local browse API: \`src/backend/queries/browse/routes.ts\`
- Cloud action: \`src/backend/database/connections/cloud-api.ts\`
- Table UI: \`src/frontend/database/explorer/objects/TableBrowseDialog.tsx\`
- Column insights and cell selection: \`src/frontend/queries/results/ColumnInsights.tsx\`, \`ResultGrid.tsx\`
- Verification: \`tests/core/column-insights.test.mjs\`, \`tests/core/table-browse.test.mjs\`, \`tests/integration/table-browse.test.ts\`

## Not included

Durable result snapshots, infinite keyset cursors for arbitrary SQL, exact global row counts, and streaming multi-gigabyte interactive tables are outside V1/V2 scope. None can be inferred from the existing retained-result pagination.
