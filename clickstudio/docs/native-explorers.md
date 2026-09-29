# Native exploration workflows

Use the Objects, MergeTree parts, History, and Insights views to explore database objects, storage activity, and query runs.

## Materialized views

Open **Objects → View dependencies** to inspect materialized views in the connection's database. A materialized view stores query results and updates them through inserts or refreshes, depending on its type.

Select a graph node to see its target, refresh schedule, latest successful refresh, duration, next refresh, and available refresh measurements. Searching focuses the graph on matching objects and their direct neighbors.

### What the relationships mean

The graph distinguishes:

- **Insert triggers:** inserts that trigger a materialized view.
- **Write targets:** objects where the view writes results.
- **Refresh order:** explicit `DEPENDS ON` relationships.
- **Catalog-loading dependencies:** relationships used when loading database object definitions.

The graph shows catalog relationships from the selected database snapshot. It identifies objects outside the snapshot and displays their available metadata.

ClickStudio reads refresh modes from the `CREATE` statement header and available refresh measurements.

### Available metadata and limits

The reader detects available optional `system.tables` columns and reads `system.view_refreshes` when permitted.

Refresh information depends on the server version and reader permissions. The app labels the metadata available to the connected user.

| Item | Limit |
| --- | --- |
| Table records retained | 250 |
| Graph objects retained | 500 |
| Relationships retained | 1,500 |
| Objects shown in the interactive graph at once | 120 |

When a limit applies, the app marks the result as incomplete.

## Parts, merges, and mutations

For a MergeTree table, choose **Visualize parts**, or open the **MergeTree parts** panel. The tabs are **Parts | Merges | Mutations**.

A merge combines data parts. The Merges tab shows source parts, the resulting part, ClickHouse's reported progress, elapsed time, average uncompressed read rate, and memory use.

A mutation changes existing data. The Mutations tab shows commands, creation time, remaining parts, completion state, and the latest error details.

The `is_done` field shows mutation completion. The panel shows progress reported by ClickHouse.

### Refresh behavior

Live activity refresh is optional. When enabled, it waits five seconds between requests. The next timer starts only after the previous request finishes.

Refresh pauses when the browser tab is hidden or the panel is inactive. Closing the view or changing it cancels its active request.

The merge and mutation views each show up to 50 records through fixed, parameterized, read-only queries. They display server activity for inspection.

Each view shows metadata from the connected server.

## Query-run comparison

Open **History → Compare runs** or **Insights → Compare runs**. Choose two completed runs on the same connection. You can compare before-and-after metrics and swap their order.

### Where measurements come from

The comparison prefers matching final query-log records. It uses client duration or run progress only when both sides use the same source.

The view labels counter availability, keeps integer precision, and handles percentage changes from a zero starting value.

The view also shows SQL, parameters, configured limits, and any pipelines already loaded for those runs in the current workspace session.

### What a comparison can tell you

Pipeline operator changes and side-by-side graphs help you compare the pipeline data loaded for each run.

Comparisons use saved run details. **Load query-log metrics** reads records for the selected query IDs.

For a complete comparison, review result values and SQL as well as row counts. Treat individual runs as observations because cache state, table data, and server activity can vary.

## Hosted preview

The hosted preview uses the browser Playground reader to read live metadata. It reports permission errors and empty system tables directly.

Sample mode shows clearly labeled, fixed examples of materialized views, merges, and mutations. Live metadata and permissions come from the connected server.

Run comparison uses the saved history available for the selected connection.

## Reader setup

For the bundled local server, run `npm run db:setup` again from `clickstudio/` after updating. Setup grants the app's reader `SELECT` access to `system.merges`, `system.mutations`, and `system.view_refreshes`, in addition to its existing catalog access.

Only the operator runs setup. The web app continues to use its reader credentials.

For an existing connection, ask the database administrator to grant access to the specific metadata tables needed by each view. Query-log access is a separate choice because it can expose SQL from other users.

Manage grants in ClickHouse. Each view uses the connected user's existing access.
