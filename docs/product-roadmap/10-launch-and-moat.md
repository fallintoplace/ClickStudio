# Product growth direction

This is a product direction note. See [Project highlights](../PROJECT-STATUS.md) for implemented features.

## Memorable workflow

The main workflow is:

> Inspect a ClickHouse result, understand how the query ran, improve the query, and share the analysis.

## Differentiators

### ClickHouse-native performance insight

Bring EXPLAIN output together with information about skipped data, connected processing stages, rows and bytes read, query IDs, history, and before-and-after comparisons.

### Excellent SQL workspace

Keep tabs, schema browsing, a searchable command menu, autocomplete, snippets, history, charts, saved revisions, and documentation in one workspace.

### Reviewable assistance

Connect each assistant proposal to its source SQL, schema details, result data, task instructions, and quality checks. Keep **Apply** and **Run** as explicit user actions.

### Reusable analysis

Let query documents support published snapshots, charts, metric definitions, shared views, reusable datasets, and monitors.

### Local and cloud-friendly operation

Keep local setup simple. Add convenient connection options for ClickHouse Cloud and remote servers.

## Release path

This is a possible order for development, not a dated release commitment:

1. **Core workspace:** SQL, results, charts, scripts, and imports.
2. **ClickHouse tools:** schema tools, EXPLAIN views, history, and run details.
3. **Assisted analysis:** reviewable AI proposals and result explanations.
4. **Reusable work:** publications, sharing, metric definitions, and links to source runs.
5. **Connected workflows:** monitors, diagnostic tools, and collaboration.
6. **Team operation:** organization policies, managed connections, and shared storage.

## Success signals

Useful measures include the time needed to get a first useful result, understand a query plan, and reopen saved work.

Other measures include the share of shared results with source SQL and a query ID, the quality of accepted assistant proposals, and how easily users move between queries, results, charts, and run details.

Repeated use of saved analysis is another useful signal.

The long-term advantage should come from combining accurate ClickHouse execution details, an easy-to-use SQL workspace, and assistant suggestions that users can inspect.
