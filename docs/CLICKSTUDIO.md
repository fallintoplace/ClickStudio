# ClickStudio: setup and implementation reference

This guide explains how to set up ClickStudio and use its main workflows. It also describes storage, execution limits, and tests.

For a shorter introduction, read the [README](../README.md). For design decisions, read [Engineering choices](ENGINEERING-NOTES.md). The [documentation index](README.md) includes a glossary.

## Architecture at a glance

ClickStudio is a ClickHouse SQL workspace designed to run locally. It has:

- A React interface built with Click UI and CodeMirror.
- An Express server API that runs queries and saves run details.
- Connection profiles managed by the server.
- Fixed sample responses for product tours and browser tests.
- A bundled Docker setup for running a real ClickHouse database.

The app is in `clickstudio/`. npm scripts at the repository root call the scripts in that folder.

Start each shell command block in this guide from the repository root unless stated otherwise. Run `npm run setup` once before using the app locally.

## First run with local ClickHouse

You need Node.js 22.12 or newer, npm, and Docker.

```sh
npm run setup
cd clickstudio
npm run init:env
docker compose up -d --wait clickhouse
npm run db:setup
npm run dev
```

After the server starts:

1. Open `http://localhost:5173`.
2. Sign in with the `CLICKSTUDIO_TOKEN` value from `clickstudio/.env`.
3. Choose **Test connection**.
4. Choose **Trust connection** and enter `local`.

The setup creates `default.events` with seven fixed sample rows and `default.import_events` as an import destination. It also creates `clickstudio_reader` for queries and `clickstudio_writer` for configured imports.

`npm run init:env` generates local credentials and an owner token. Keep `.env` private.

## Sample workspace

Use sample mode to try the interface without a live database:

```sh
cd clickstudio
DEMO_MODE=true npm run dev
```

It returns fixed example responses for editing, results, charts, progress, cancellation, history, and EXPLAIN views. It does not evaluate your SQL.

Live mode uses the same interface but runs queries against a real ClickHouse database.

## Containerized application

After generating local credentials as described above, you can run the full app with Docker Compose:

```sh
cd clickstudio
docker compose --profile app up --build
```

Open `http://localhost:8080`.

The setup service initializes ClickHouse. The app service starts with the reader and writer credentials, owner token, and any configured model credentials.

To build and run the production app locally instead:

```sh
cd clickstudio
npm run build
NODE_ENV=production npm run start:production
```

## Editor workflow

The editor keeps tabs and drafts separate for each connection. You can run the current statement, run selected SQL, or run a multi-statement script.

It also supports named ClickHouse parameters, formatting, validation, query history, saved revisions, and saved run details. See [SQL editing tools](EDITOR-TOOLS.md) for navigation, snippets, and autocomplete.

## Schema and object exploration

The schema explorer shows the selected database and ClickHouse system tables. A schema describes tables, columns, and their types.

For a system table, choose **Read ClickHouse documentation** to load documentation from the connected server. The view also shows the server version.

For a MergeTree-family table, choose **Visualize parts**. A part is a stored piece of table data. The view groups active and inactive `system.parts` rows by partition.

The horizontal map sizes bars by compressed bytes by default. You can switch to rows or marks, or choose the Treemap or Galaxy layout. Part details include rows, marks, compressed and uncompressed bytes, compression ratio, level, block range, disk, and modification time.

The preview shows at most 500 parts per state. Total counts and state counts remain exact even when the preview is limited.

The object explorer helps you inspect database objects and open related SQL workflows. See [Native exploration workflows](../clickstudio/docs/native-explorers.md) for materialized views, merges, mutations, and run comparisons.

## Example workflows

More runnable examples are in [`clickstudio/examples/analysis.sql`](../clickstudio/examples/analysis.sql).

### Table-free smoke test

This query does not need an existing table:

```sql
SELECT
    toDate('2026-01-01') + toUInt32(number) AS day,
    toUInt64((number + 1) * 10) AS events
FROM numbers(7)
ORDER BY day;
```

Use it to check column types, charts, export, and saved run details.

### Seeded local data

After running `npm run db:setup`, try:

```sql
SELECT
    day,
    events,
    sum(events) OVER (ORDER BY day) AS running_events
FROM default.events
ORDER BY day;
```

The result contains multiple numeric columns that you can compare in a table or chart.

### Named parameters

A parameter is a named value supplied separately from the SQL:

```sql
SELECT day, events
FROM default.events
WHERE events >= {minimum:UInt64}
ORDER BY day;
```

Before running the query, set `minimum=30` in the editor's parameter control.

### Scripts

A script can contain more than one statement:

```sql
SELECT count() AS days FROM default.events;

SELECT sum(events) AS total_events FROM default.events;
```

Choose **Run script** to keep a separate result for each statement.

## EXPLAIN experiences

These four views explain how ClickHouse plans or runs a query. They show different information.

### EXPLAIN INDEXES

Shows index checks and counts of parts and granules that ClickHouse can skip. Granules are groups of rows used when reading data. The graph shows this filtering path, and the raw output stays available.

### EXPLAIN PLAN

Shows the logical steps in the query plan as a graph or tree. Select a step to inspect its properties.

### EXPLAIN PIPELINE

Shows how processing stages connect and which stages can run in parallel. This is the planned execution structure, not measured runtime performance.

### EXPLAIN ANALYZE

**This action runs the selected query.** ClickHouse discards the query's result rows and returns execution analysis, which ClickStudio saves.

It requires a connection that supports native `EXPLAIN ANALYZE`, introduced in ClickHouse 26.7. The bundled local ClickHouse 24.6 server does not support it.

The runtime graph shows measured time, data flow, and parallel work. It follows data from reads toward the result and highlights slower stages. Raw output remains in the Results tab.

In sample mode, the view shows fixed example measurements. It does not evaluate the SQL.

The SQL Structure view also includes a server-resolved **Analyzer** tree, a local abstract syntax tree (AST), and logical flow. An AST represents the structure of parsed SQL.

## Execution evidence

Execution evidence means the saved details of a query run. Each run gets a query ID generated by the server.

ClickStudio keeps the SQL, supplied parameters, execution identity, limits, timestamps, result state, and typed result data together. A chart, profile, plan, or saved result can then refer to the exact run that produced it.

Editing a draft does not change an earlier run's saved details.

## Result fidelity

Results keep column names and ClickHouse types together with the row values.

`UInt64` and `Decimal` values are sent as strings where needed to preserve exact values. This avoids losing precision when the data reaches JavaScript.

Tables show results in pages. Charts use numeric coordinates for drawing. Table and JSON views keep exact values for inspection and export.

## Child analysis

Clicking a chart or interacting with a cell can create a follow-up SQL draft with a filter parameter.

This is called a child query. It keeps a link to the source analysis so you can see where the follow-up began.

## Saving, publishing, and sharing

These are separate actions:

1. **Save** creates a server revision. It checks whether the saved version changed before accepting an update. This is called optimistic concurrency.
2. **Publish** connects a saved revision to a completed run. It freezes the selected chart and a result snapshot with size limits.
3. **Share** creates a read link for the published snapshot.

A snapshot is a saved copy. Later draft edits do not change that copy.

## Connection configuration

The browser selects a connection by its profile ID. The server stores the connection details and credentials.

For multiple profiles, set `CONNECTIONS_FILE` to a JSON configuration file. See [`clickstudio/examples/connections.json`](../clickstudio/examples/connections.json) for the format.

The configuration refers to passwords by their environment variable names. It does not need to send passwords to the browser.

## ClickHouse permissions

The bundled local setup uses separate database users:

- `clickstudio_reader`: read-only query execution.
- `clickstudio_writer`: writes to configured import tables.
- `clickstudio_admin`: setup tasks.

SQL checks in the app give useful feedback. ClickHouse grants enforce database permissions. The app's checks do not replace those grants.

The reader profile also sets operational settings for queries with execution limits.

## Imports

Choose **Import** and upload CSV, JSON, or NDJSON. NDJSON means newline-delimited JSON: each line contains a JSON record.

Then:

1. Preview the file.
2. Choose a configured destination table.
3. Review how file columns map to table columns.
4. Confirm the exact number of rows.
5. Run the import through the writer user.

[`clickstudio/examples/import.csv`](../clickstudio/examples/import.csv) matches `default.import_events(day Date, events UInt64)`.

Immediately before insertion, the app checks the mapping against the destination schema. Each mapping identifies one import operation.

## Assistant workflow

Set `OPENAI_API_KEY` and `OPENAI_MODEL` on the server to enable model actions.

The assistant can generate, explain, repair, and review SQL. It can also analyze results and performance.

Before you give consent, the app shows the information prepared for the model. This can include the current SQL, selected schema, up to four relevant ClickHouse reference entries, and selected result evidence. The preview names the reference entries.

The app prefers documentation from the selected server. When that is unavailable, it uses the bundled offline reference.

The workflow has separate steps:

1. Inspect the prepared context.
2. Generate a proposal.
3. Review the proposal.
4. Apply it to the editor.
5. Run the SQL.

Each proposal includes quality information. The checks cover the playbook's expected output, read-only SQL safety, use of known schema objects, and a static estimate of whether the proposal fits the task. This estimate does not prove that the SQL answers the question correctly.

The local `eval:assistant` command runs fixed benchmark cases for the main assistant behaviors.

## Observability

Observability means using traces and other diagnostic records to understand what the app did.

Optional OpenTelemetry configuration can send API trace metadata through `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`. A trace connects the steps in a request.

`TRACE_URL_TEMPLATE` can turn a saved trace ID into a link to your existing monitoring system.

Query IDs stay visible in the app. Use them to match a ClickStudio run with ClickHouse diagnostic records.

## Persistence

The server saves data under `DATA_DIR` in JSON files. It replaces files atomically, so each new file replaces the old version as one operation. Browser drafts use separate local workspace storage.

The stored models include query documents, executions, results, publications, imports, proposals, sessions, and workspace state.

This keeps local setup small. The separate models also leave room for shared storage with transactions in the future.

## Execution limits

| Setting | Default | Application maximum |
| --- | --- | --- |
| Result rows | 5,000 | 20,000 |
| Result size | 2 MB | 5 MB |
| Run time | 30 seconds | 120 seconds |
| Memory | 512 MiB | 1 GiB |
| Threads | 4 | 8 |

These limits help control query resource use and the size of saved results.

## Retention

Saved data is not kept without limits. ClickStudio limits stored run results, published snapshots, import previews, histories, documents, uploads, proposals, queues, sessions, and audit metadata.

This keeps local storage use predictable while preserving recent work.

## Validation commands

For live integration checks, start the bundled database and set `CLICKHOUSE_INTEGRATION=1` before running `test:integration`. The [README](../README.md#validation) shows the complete live-test command.

From the repository root:

```sh
cd clickstudio
npm test
npm run typecheck
npm run lint
npm run coverage
npm run build
npm run test:integration
npm run test:e2e:core
```

Browser tests use fixed sample responses for the main workflows. Live integration tests check the app against the bundled ClickHouse server.

To run the main project checks from the repository root:

```sh
npm run check
```
