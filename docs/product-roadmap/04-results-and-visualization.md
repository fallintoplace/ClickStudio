# Results and charts

This guide explores future ideas for ClickStudio. See [Project highlights](../PROJECT-STATUS.md) for features available today.

## Goal

Make each query result easy to inspect, save, and use in further analysis.

## Result details

A result can keep its column types, exact values, row and byte counts, execution identity, query ID, source SQL, and parameters.

It can also show when the data was produced and how long it will be kept. These details help users judge whether the result is still useful.

## Table workflow

Useful table tools include pages, filters, sorting where appropriate, statistics, CSV export, and a JSON view.

Actions on columns or cells can create a follow-up query. The new query should keep a link to the result that started it.

## Visualization workflow

Charts can use saved result data directly. Useful options include automatic chart suggestions and line, bar, area, scatter, and other chart types.

Clicking a chart can create a filtered follow-up query. Saved chart settings and published snapshots should keep links to the original SQL and run.

## Performance insight

A result view can connect to query profiles, `EXPLAIN INDEXES`, `EXPLAIN PLAN`, `EXPLAIN PIPELINE`, and comparisons with earlier runs.

This lets users inspect both the answer and how ClickHouse produced it.

## Product direction

Saved results could support dashboards, reports, monitors, and shared analysis. Each use should preserve the source SQL and run details.
