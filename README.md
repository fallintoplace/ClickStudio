# ClickStudio

ClickStudio is a SQL editor for ClickHouse that you can run on your own computer. Use it to write queries, inspect results, build charts, and understand query performance.

Each query run keeps its SQL, parameters, limits, results, and run details together. You can return to a saved run and see how it produced its result.

The interface uses React, Click UI, and CodeMirror. A server API runs queries with limits on time, memory, and result size.

## Reviewer tour

To review the project:

1. Start the **sample workspace** below. Try the editor, results, charts, and EXPLAIN views.
2. Read [Engineering choices](docs/ENGINEERING-NOTES.md) to understand how the app works and why it was built this way.
3. Read [Project highlights](docs/PROJECT-STATUS.md) to see the implemented features.
4. Use the [setup and implementation reference](docs/CLICKSTUDIO.md) for detailed instructions.

The main goal is to make each query easy to inspect. SQL, database behavior, execution limits, and saved run details stay visible.

## Quick start

You need **Node.js 22.12 or newer** and npm. You also need Docker to use the bundled local ClickHouse server.

Start each shell command block below from the repository root: the folder that contains this README. Commands such as `cd clickstudio` then move into the application folder.

### Sample workspace

Use sample mode to try the interface without setting up a database:

```sh
npm run setup
cd clickstudio
DEMO_MODE=true npm run dev
```

Open `http://localhost:5173` and choose **Start exploring**.

Sample mode uses fixed example responses. It is useful for product tours and repeatable browser tests. It does not run your SQL against a real database.

### Local ClickHouse

The bundled Docker Compose setup uses ClickHouse 24.6 for compatibility testing:

```sh
npm run setup
cd clickstudio
npm run init:env
docker compose up -d --wait clickhouse
npm run db:setup
npm run dev
```

Then:

1. Open `http://localhost:5173`.
2. Sign in with the `CLICKSTUDIO_TOKEN` value from `clickstudio/.env`.
3. Choose **Test connection**.
4. Choose **Trust connection** and enter `local`.

The setup adds sample data to `default.events`. Try this query:

```sql
SELECT day, events
FROM default.events
ORDER BY day;
```

The Run actions beside **Run statement** include **EXPLAIN INDEXES**, **EXPLAIN PLAN**, **EXPLAIN PIPELINE**, and **EXPLAIN ANALYZE**. These views help explain how ClickHouse processes a query.

**EXPLAIN ANALYZE runs the selected query.** It requires ClickHouse 26.7 or newer, so it is not available on the bundled 24.6 server.

Database credentials and optional AI model credentials stay on the server.

## Examples

These files match the bundled local setup:

- [`clickstudio/examples/analysis.sql`](clickstudio/examples/analysis.sql): queries without a table, seeded data, exact numeric values, schema inspection, parameters, and query plans.
- [`clickstudio/examples/import.csv`](clickstudio/examples/import.csv): sample rows for `default.import_events`.
- [`clickstudio/examples/connections.json`](clickstudio/examples/connections.json): configuration for more than one connection.

## Highlights

- **Write and run SQL.** Format and validate queries. Run read-only SQL or a script with separate results for each statement.
- **Explore the database.** Browse databases, tables, columns, and system-table documentation. Inspect active and inactive MergeTree data parts.
- **Work with results.** View column types, move between result pages, build charts, and save query documents.
- **Import data.** Preview CSV, JSON, or NDJSON files, map their columns, and confirm the row count before importing.
- **Understand a run.** Track progress, cancel queries, reopen saved run details, and inspect interactive query-plan and runtime graphs.
- **Use the assistant.** Review the information sent to the model and its SQL suggestion before applying or running it.

## Validation

Run the main project checks:

```sh
npm run check
```

This checks syntax, TypeScript types, ESLint rules, test coverage requirements, and the production build.

To test the main browser workflows:

```sh
cd clickstudio
npm run test:e2e:core
```

For live ClickHouse integration checks, first start and set up the local database as shown above. Then run:

```sh
cd clickstudio
CLICKHOUSE_INTEGRATION=1 npm run test:integration
npm run eval
```

## Documentation

- [Documentation index](docs/README.md): all guides and a glossary of common terms.
- [Engineering choices](docs/ENGINEERING-NOTES.md): how the app is built and why.
- [Project highlights](docs/PROJECT-STATUS.md): implemented features and current scope.
- [Setup and implementation reference](docs/CLICKSTUDIO.md): setup, configuration, and detailed behavior.
- [Product exploration](docs/product-roadmap/): ideas for future development, not a list of available features.
