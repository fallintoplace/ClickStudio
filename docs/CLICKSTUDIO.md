# ClickStudio: setup and implementation reference

This reference covers the ClickStudio setup, architecture, workflows, and validation. For a shorter review path, start with the [README](../README.md) and [Engineering choices](ENGINEERING-NOTES.md).

## Architecture at a glance

ClickStudio is a local-first ClickHouse SQL workspace with:

- a React interface built with Click UI and CodeMirror;
- an Express server API for execution and retained evidence;
- server-managed ClickHouse connection profiles;
- deterministic sample data for fast product exploration;
- live ClickHouse integration through the bundled Docker setup.

The application lives in `clickstudio/`; root npm scripts delegate there.

## First run with local ClickHouse

Use Node 22.12 or newer:

```sh
npm run setup
cd clickstudio
npm run init:env
docker compose up -d --wait clickhouse
npm run db:setup
npm run dev
```

Open `http://localhost:5173`, sign in with `CLICKSTUDIO_TOKEN` from `clickstudio/.env`, choose **Test connection**, then **Trust connection** and enter `local`.

The setup creates:

- `default.events` with seven deterministic rows;
- `default.import_events` as an import destination;
- `clickstudio_reader` for query execution;
- `clickstudio_writer` for configured imports.

`npm run init:env` generates local credentials and an owner token. Store `.env` privately.

## Sample workspace

For the fastest UI tour:

```sh
cd clickstudio
DEMO_MODE=true npm run dev
```

Sample mode provides deterministic responses for editor workflows, results, charts, progress, cancellation, history, and EXPLAIN views.

Live ClickHouse mode uses the same interface with real database execution.

## Containerized application

The full application can run through Docker Compose:

```sh
cd clickstudio
docker compose --profile app up --build
```

Open `http://localhost:8080`.

The setup service initializes ClickHouse, and the application service starts with the reader, writer, owner token, and optional model credentials.

For a local production build:

```sh
cd clickstudio
npm run build
NODE_ENV=production npm run start:production
```

## Editor workflow

The editor supports:

- connection-scoped tabs and drafts;
- current-statement and selection execution;
- multi-statement scripts;
- named ClickHouse parameters;
- SQL formatting and validation;
- query history;
- saved revisions;
- retained execution evidence.

## Schema and object exploration

The schema explorer presents the selected database alongside ClickHouse system tables.

For system tables, **Read ClickHouse documentation** loads native documentation from the connected server and displays the associated server version.

For MergeTree-family tables, select **Visualize parts** to inspect active and inactive `system.parts` rows grouped by partition. The horizontal map uses compressed bytes by default; switch its bar scale to rows or marks, or choose the Treemap and Galaxy layouts. Part details include rows, marks, compressed and uncompressed bytes, compression ratio, level, block range, disk, and modification time. The preview shows up to 500 parts per state while the total and state counts remain exact.

The object explorer also provides a unified way to inspect database objects and move directly into relevant SQL workflows.

## Example workflows

Runnable examples live in [`clickstudio/examples/analysis.sql`](../clickstudio/examples/analysis.sql).

### Table-free smoke test

```sql
SELECT
    toDate('2026-01-01') + toUInt32(number) AS day,
    toUInt64((number + 1) * 10) AS events
FROM numbers(7)
ORDER BY day;
```

This is useful for checking result typing, charts, export, and retained evidence.

### Seeded local data

After `npm run db:setup`:

```sql
SELECT
    day,
    events,
    sum(events) OVER (ORDER BY day) AS running_events
FROM default.events
ORDER BY day;
```

This produces multiple numeric series for table and chart exploration.

### Named parameters

```sql
SELECT day, events
FROM default.events
WHERE events >= {minimum:UInt64}
ORDER BY day;
```

Set `minimum=30` in the editor parameter control before running.

### Scripts

```sql
SELECT count() AS days FROM default.events;

SELECT sum(events) AS total_events FROM default.events;
```

Choose **Run script** to retain a result for each statement.

## EXPLAIN experiences

ClickStudio provides four ClickHouse-specific execution analysis paths.

### EXPLAIN INDEXES

Shows ClickHouse-reported index checks and pruning counts, including parts and granules. The graph makes the pruning path easy to scan while the raw output remains available.

### EXPLAIN PLAN

Shows the logical query plan with graph and tree presentations. Selecting a step reveals its properties.

### EXPLAIN PIPELINE

Shows the planned processor topology and parallel lanes. This is useful for understanding how ClickHouse intends to execute the query.

### EXPLAIN ANALYZE

Runs the selected query and displays measured time, data flow, and parallelism in an interactive runtime graph. The query runs on ClickHouse; the result rows are discarded and the explain output is retained. This action is available when the selected connection supports native `EXPLAIN ANALYZE` (introduced in ClickHouse 26.7).

The runtime graph follows data from reads toward the result, emphasizes slower stages, and retains raw output in the Results tab. Sample mode displays deterministic fixture metrics and does not evaluate the SQL.

The SQL Structure view also includes a server-resolved **Analyzer** tree alongside the local AST and logical flow.

Together these views turn ClickHouse planning and runtime output into an interactive part of the SQL workflow.

## Execution evidence

Every run receives a server-generated query ID.

ClickStudio retains:

- SQL;
- bound parameters;
- execution identity;
- limits;
- timestamps;
- result state;
- typed result data.

This allows a saved result, chart, profile, or plan to stay connected to the exact execution that produced it.

Editing a draft creates a new analysis state while retained runs continue to describe their original execution.

## Result fidelity

Result data keeps column names and ClickHouse type metadata alongside row values.

`UInt64` and `Decimal` values use string transport where exact representation matters. This preserves database precision across the JavaScript boundary.

Tables render results in pages, while charts use numeric coordinates suitable for visualization. Table and JSON views preserve exact values for inspection and export.

## Child analysis

A chart click or cell interaction can create a child SQL draft with a bound filter parameter.

This makes it easy to move from a result into a more focused query while preserving lineage back to the source analysis.

## Saving, publishing, and sharing

Saving creates a server revision with optimistic concurrency.

Publishing connects a saved revision to completed execution evidence and freezes the selected chart plus a bounded result snapshot.

Sharing creates a dedicated read link for the published snapshot.

These stages make the lifecycle from working SQL to shareable analysis explicit and easy to inspect.

## Connection configuration

The browser selects connection profile IDs, while the server owns connection details.

For multiple profiles, set `CONNECTIONS_FILE` to a JSON configuration. [`clickstudio/examples/connections.json`](../clickstudio/examples/connections.json) shows the format.

Passwords are referenced through environment variable names.

This keeps connection configuration centralized and credentials server-side.

## ClickHouse permissions

The bundled local setup uses separate identities:

- `clickstudio_reader` for read-only query execution;
- `clickstudio_writer` for configured import tables;
- `clickstudio_admin` for setup.

Application SQL checks provide clear product feedback, while ClickHouse grants provide the database authorization layer.

The reader profile also configures the operational settings used by bounded execution.

## Imports

Choose **Import** and upload CSV, JSON, or NDJSON.

The workflow is:

1. preview the source;
2. choose the configured destination;
3. review column mapping;
4. confirm the exact row count;
5. execute the import through the writer identity.

[`clickstudio/examples/import.csv`](../clickstudio/examples/import.csv) matches `default.import_events(day Date, events UInt64)`.

The mapping is checked against the destination schema immediately before insertion, and each mapping identifies a single import operation.

## Assistant workflow

Set `OPENAI_API_KEY` and `OPENAI_MODEL` on the server to enable model actions.

The assistant supports:

- generate;
- explain;
- repair;
- result analysis;
- performance analysis;
- review.

The product presents the context prepared for the model, including current SQL, selected schema, up to four relevant ClickHouse reference entries, and chosen result evidence. Native documentation from the selected server is preferred; the bundled offline reference is used when native docs are unavailable. The preview names the entries before consent.

The workflow is:

**inspect context → generate proposal → review → apply → run**

Each proposal receives quality metadata covering the playbook contract, read-only SQL safety, schema grounding, and a static semantic proxy.

The local `eval:assistant` command runs deterministic benchmark cases for core assistant behaviors.

## Observability

Optional OpenTelemetry configuration can emit API trace metadata through `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`.

`TRACE_URL_TEMPLATE` can turn a retained trace ID into a link to an existing observability system.

Query IDs remain visible throughout the execution workflow, which makes ClickHouse-side diagnostics easy to correlate with application activity.

## Persistence

Server data is stored under `DATA_DIR` using atomic JSON-file replacement. Browser drafts use separate local workspace storage.

This keeps the project lightweight to run while preserving clear models for:

- query documents;
- executions;
- retained results;
- publications;
- imports;
- proposals;
- sessions;
- workspace state.

The structure provides a straightforward path to shared transactional storage as the product grows.

## Execution limits

Default run settings:

- 5,000 rows;
- 2 MB result size;
- 30 seconds;
- 512 MiB memory;
- four threads.

Application maxima:

- 20,000 rows;
- 5 MB result size;
- 120 seconds;
- 1 GiB memory;
- eight threads.

These limits make query behavior predictable and keep retained evidence compact.

## Retention

ClickStudio applies bounded retention to run results, published snapshots, import previews, histories, documents, uploads, proposals, queues, sessions, and audit metadata.

This keeps local storage predictable while preserving recent analysis context.

## Validation commands

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

The deterministic browser suite covers the main product workflows. The integration suite exercises the application against the bundled ClickHouse instance.

The root quality gate is:

```sh
npm run check
```
