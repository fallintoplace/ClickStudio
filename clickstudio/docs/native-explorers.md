# Native exploration workflows

Use the existing Objects, MergeTree parts, History, and Insights views to inspect database objects, storage activity, and query runs. These tools do not add a separate workspace mode.

## Materialized views

Open **Objects → View dependencies** to inspect materialized views in the connection's database. A materialized view stores query results and updates them through inserts or refreshes, depending on its type.

Select a graph node to see its target, refresh schedule, latest successful refresh, duration, next refresh, and available refresh measurements. Searching focuses the graph on matching objects and their direct neighbors.

### What the relationships mean

The graph distinguishes:

- **Insert triggers:** inserts that trigger a materialized view.
- **Write targets:** objects where the view writes results.
- **Refresh order:** explicit `DEPENDS ON` relationships.
- **Catalog-loading dependencies:** relationships used when loading database object definitions.

Catalog dependencies do not show every path that data takes through SQL. Objects outside the database snapshot remain identifiable even when their full metadata is unavailable.

ClickStudio reads refresh modes from the actual `CREATE` statement header and refresh measurements. It does not guess the mode from the server version or enable experimental settings.

### Available metadata and limits

The reader checks which optional `system.tables` columns are available. It also reads `system.view_refreshes` when it has access.

An older server or missing permissions may limit refresh information. The app keeps the metadata it can read and explains what is missing.

| Item | Limit |
| --- | --- |
| Table records retained | 250 |
| Graph objects retained | 500 |
| Relationships retained | 1,500 |
| Objects shown in the interactive graph at once | 120 |

When these limits exclude metadata, the app marks the result as incomplete.

## Parts, merges, and mutations

For a MergeTree table, choose **Visualize parts**, or open the **MergeTree parts** panel. The tabs are **Parts | Merges | Mutations**.

A merge combines data parts. The Merges tab shows source parts, the resulting part, ClickHouse's reported progress, elapsed time, average uncompressed read rate, and memory use.

A mutation changes existing data. The Mutations tab shows commands, creation time, remaining parts, completion state, and the latest failure details.

**Zero remaining parts does not mean a mutation is complete.** The `is_done` field determines completion. The app does not estimate a progress percentage.

### Refresh behavior

Live activity refresh is optional. When enabled, it waits five seconds between requests. The next timer starts only after the previous request finishes.

Refresh pauses when the browser tab is hidden or the panel is inactive. Closing the view or changing it cancels its active request.

The merge and mutation views each have a 50-record limit. They use fixed, parameterized, read-only queries. They do not issue commands to merge data, mutate data, or refresh a materialized view.

Metadata comes from the connected server. ClickStudio does not issue its own query to combine activity across a cluster.

## Query-run comparison

Open **History → Compare runs** or **Insights → Compare runs**. Choose two completed runs on the same connection. You can compare before-and-after metrics and swap their order.

### Where measurements come from

The comparison prefers matching final query-log records. It uses client duration or run progress only when both sides use the same source.

Missing counters stay unavailable rather than becoming zero. Integer values keep their exact precision. Percentage changes account for a zero starting value.

The view also shows SQL, parameters, configured limits, and any pipelines already loaded for those runs in the current workspace session.

### What a comparison can tell you

Pipeline operator changes and side-by-side graphs help you inspect differences. They do not prove that two queries return the same result or show the runtime plans used historically.

Comparison does not run SQL or EXPLAIN again. **Load query-log metrics** only reads records for the selected query IDs.

Equal saved row counts do not prove that results are equal. Two individual runs are also not a controlled benchmark: cached data, table data, and other server work may differ.

## Hosted preview

The hosted preview uses the browser Playground reader to read live metadata. It reports permission errors and empty system tables directly.

Sample mode has clearly labelled, fixed examples of materialized views, merges, and mutations. A failed live request is never replaced with sample data.

Run comparison uses the saved history available for the selected connection.

## Reader setup

For the bundled local server, run `npm run db:setup` again from `clickstudio/` after updating. Setup grants the app's reader `SELECT` access to `system.merges`, `system.mutations`, and `system.view_refreshes`, in addition to its existing catalog access.

Only the operator runs setup. The web app continues to use its reader credentials.

For an existing connection, ask the database administrator to grant access to the specific metadata tables needed by each view. Query-log access is a separate choice because it can expose SQL from other users.

ClickStudio never changes grants on a connected server.
