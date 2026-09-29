# ClickStudio docs

Find guides to start ClickStudio, explore its features, and understand how it works.

## Start here

- [Main README](../README.md): setup, sample workspace, data sources, and AI.
- [Project highlights](PROJECT-STATUS.md): features available in the app.
- [Engineering choices](ENGINEERING-NOTES.md): how the app is designed.

## Guides

| Guide | Topics |
| --- | --- |
| [Setup and implementation](CLICKSTUDIO.md) | Setup, settings, query runs, saved data, imports, AI, and checks. |
| [SQL editing tools](EDITOR-TOOLS.md) | Statements, snippets, and autocomplete. |
| [Explore ClickHouse](../clickstudio/docs/native-explorers.md) | Materialized views, data parts, merges, mutations, and query comparisons. |
| [Map data](../clickstudio/web/geo-data.md) | Map background source and local file. |
| [ClickHouse docs data](../clickstudio/CLICKHOUSE-DOCS-NOTICE.md) | Offline reference source, license, and update command. |
| [ClickHouse parser](../clickstudio/vendor/clickhouse-parser/SOURCE.md) | Source revision, build steps, and license. |

## Product ideas

[Explore product ideas](product-roadmap/) for collaboration, AI support, and team settings. [Project highlights](PROJECT-STATUS.md) describes features available today.

## Common terms

| Term | Meaning |
| --- | --- |
| Connection profile | Saved settings for one database connection. |
| Schema | A database’s tables, columns, and data types. |
| Parameter | A named value used by a query. |
| Run | One query execution with saved details and results. |
| Execution evidence | SQL, settings, results, and measurements saved for a run. |
| Snapshot | A saved copy of data from one point in time. |
| Lineage | Shows which query created a result or chart. |
| Fixed sample data | Example data that gives the same results each time. |
| Reader and writer | Database users for reading or writing data. |
| Playbook | Instructions and expected results for an assistant task. |
