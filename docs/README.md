# ClickStudio documentation

Use these guides to run ClickStudio, learn its features, or review the implementation.

## Start here

1. [Repository README](../README.md): install the app, start it, and try a query.
2. [Project highlights](PROJECT-STATUS.md): see what is implemented and the project's current scope.
3. [Engineering choices](ENGINEERING-NOTES.md): understand the main design decisions.

## Detailed guides

| Guide | What you will learn |
| --- | --- |
| [Setup and implementation reference](CLICKSTUDIO.md) | Setup, configuration, query runs, saved data, imports, the assistant, and tests. |
| [SQL editing tools](EDITOR-TOOLS.md) | Move between statements, insert snippets, and use autocomplete. |
| [Native exploration workflows](../clickstudio/docs/native-explorers.md) | Inspect materialized views, parts, merges, mutations, and query-run comparisons. |
| [Map data](../clickstudio/web/geo-data.md) | Find the source and local file for the map background. |
| [ClickHouse documentation data](../clickstudio/CLICKHOUSE-DOCS-NOTICE.md) | Find the source, license, and regeneration command for the offline reference. |
| [ClickHouse native parser](../clickstudio/vendor/clickhouse-parser/SOURCE.md) | Find the parser's source revision, build details, and license. |

## Future ideas

[Product exploration](product-roadmap/) describes possible future work, including collaboration, AI assistance, and team policies. These notes are not a release schedule or a promise that every feature is available. Use [Project highlights](PROJECT-STATUS.md) for implemented features.

## Common terms

| Term | Meaning in these guides |
| --- | --- |
| Connection profile | Server settings for a database connection, such as its address, database name, and user. |
| Schema | The structure of a database, including its tables, columns, and data types. |
| Parameter | A named value supplied to a query, such as `minimum` in `{minimum:UInt64}`. |
| Run | One execution of a query, with its own ID and saved details. |
| Execution evidence | Saved information about a run, such as its SQL, parameters, limits, results, and measurements. |
| Snapshot | A saved copy of data at a particular point. It does not change when you edit the draft. |
| Lineage | Links from a result, chart, or follow-up query back to the work that produced it. |
| Deterministic sample data | Fixed example responses that stay the same for repeatable tours and tests. |
| Reader and writer | Separate database users: one reads data; the other performs configured write operations. |
| Playbook | A reusable set of instructions and expected outputs for an assistant task. |
