# ClickStudio

A local-first ClickHouse SQL workbench built with React, Click UI, CodeMirror, and a bounded server API. ClickStudio keeps SQL, parameters, execution limits, results, and query evidence tied to each run so every analysis step stays easy to inspect and revisit.

## Reviewer tour

For a fast review:

1. Start the **sample workspace** and explore the editor, results, charts, and EXPLAIN views.
2. Read [Engineering choices](docs/ENGINEERING-NOTES.md) for the architecture and product reasoning.
3. Open [Project highlights](docs/PROJECT-STATUS.md) for the implemented feature set and technical focus.
4. Use the [setup and implementation reference](docs/CLICKSTUDIO.md) for deeper details.

The core idea is simple: make ClickHouse query execution **inspectable, bounded, and connected to durable evidence** while keeping the SQL and database behavior visible.

## Quick start

Requires **Node.js 22.12+** and npm. Docker powers the live ClickHouse path.

### Sample workspace

Use the deterministic sample workspace for the fastest product tour:

```sh
npm run setup
cd clickstudio
DEMO_MODE=true npm run dev
```

Open `http://localhost:5173` and choose **Start exploring**.

Sample mode provides stable fixture responses for repeatable UI exploration and browser testing.

### Local ClickHouse

The bundled Docker Compose setup starts the ClickHouse 24.6 compatibility fixture used by this project:

```sh
npm run setup
cd clickstudio
npm run init:env
docker compose up -d --wait clickhouse
npm run db:setup
npm run dev
```

Open `http://localhost:5173`, sign in with `CLICKSTUDIO_TOKEN` from `clickstudio/.env`, choose **Test connection**, then **Trust connection** and enter `local`.

The setup seeds `default.events`. A first live query is:

```sql
SELECT day, events
FROM default.events
ORDER BY day;
```

Use the Run actions beside **Run statement** to inspect **EXPLAIN INDEXES**, **EXPLAIN PLAN**, **EXPLAIN PIPELINE**, or **EXPLAIN ANALYZE**. EXPLAIN ANALYZE executes the selected query and is available on ClickHouse 26.7 or newer.

Database and optional model-provider credentials stay on the server.

## Examples

The repository includes copy-pasteable examples that match the bundled local setup:

- [`clickstudio/examples/analysis.sql`](clickstudio/examples/analysis.sql) covers a table-free query, the seeded dataset, exact ClickHouse numeric values, schema inspection, parameters, and plan/pipeline workflows.
- [`clickstudio/examples/import.csv`](clickstudio/examples/import.csv) can be imported into `default.import_events`.
- [`clickstudio/examples/connections.json`](clickstudio/examples/connections.json) shows the multi-connection configuration format.

## Highlights

- Run read-only SQL and inspect typed, paginated results.
- Format and validate ClickHouse SQL in the editor.
- Run scripts and inspect each statement separately.
- Explore databases, tables, columns, native system-table documentation, and active/inactive MergeTree part storage.
- Import CSV, JSON, or NDJSON through preview, mapping, and explicit row-count confirmation.
- Track execution progress, cancel queries, and reopen retained evidence.
- Save query documents, build charts, and inspect query history.
- Explore index pruning, logical plans, execution pipelines, and measured runtime through interactive graph views.
- Review assistant context and SQL proposals before applying and running them.

## Validation

Run the main local quality gate:

```sh
npm run check
```

It covers syntax checks, TypeScript, ESLint, coverage gates, and the production build.

For focused browser coverage:

```sh
cd clickstudio
npm run test:e2e:core
```

For live ClickHouse integration checks:

```sh
cd clickstudio
CLICKHOUSE_INTEGRATION=1 npm run test:integration
npm run eval
```

## Documentation

- [Documentation index](docs/README.md) - reviewer-oriented map of the repository docs.
- [Engineering choices](docs/ENGINEERING-NOTES.md) - architecture and implementation reasoning.
- [Project highlights](docs/PROJECT-STATUS.md) - implemented capabilities and technical focus.
- [Setup and implementation reference](docs/CLICKSTUDIO.md) - detailed setup and behavior.
- [Product exploration](docs/product-roadmap/) - broader product ideas and future directions.
