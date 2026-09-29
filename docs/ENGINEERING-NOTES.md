# Engineering choices

This guide explains ClickStudio's main technical decisions.

## 1. Server-mediated ClickHouse access

The browser sends requests to a small server API. The server then runs the queries in ClickHouse.

This keeps database credentials on the server and query limits in one place. Users can review a connection profile before running SQL. Imports use a separate database user with permission to write to configured tables.

The server can also add connection rules as the product grows.

## 2. Execution-scoped evidence

Each query run has its own ID and saved details: SQL, parameters, limits, timestamps, result state, and result data.

Charts, history, saved revisions, EXPLAIN views, and assistant proposals can refer to that exact run. Each run keeps the SQL and details from the moment it ran.

## 3. Database-native permissions

The bundled setup uses three types of database user:

- A read-only user for normal queries.
- A user with `INSERT` permission for imports into configured tables.
- An administrator for local setup.

SQL checks give useful feedback. ClickHouse grants enforce access directly in the database.

## 4. ClickHouse type fidelity

Results keep each column's ClickHouse type together with its values.

Large `UInt64` and `Decimal` values use strings to preserve exact precision in JavaScript.

Charts use numeric coordinates where appropriate. Table and JSON views keep exact values for inspection.

## 5. Deterministic sample mode

Sample mode returns fixed example responses, so reviewers and browser tests see the same data each time.

The examples cover editing, progress, cancellation, charts, EXPLAIN views, history, and saved results. Live mode runs queries against a ClickHouse database in the same interface.

## 6. Structured EXPLAIN experiences

ClickStudio has separate views for **EXPLAIN INDEXES**, **EXPLAIN PLAN**, **EXPLAIN PIPELINE**, and **EXPLAIN ANALYZE**.

The app turns ClickHouse output into interactive graphs with size limits. It also keeps the raw output available. The views explain which data ClickHouse can skip, the steps in a plan, how processors connect, and measured execution details.

Runtime analysis runs the selected query. ClickStudio enables it when the connected server supports it.

The MergeTree storage view reads `system.parts` through a limited, read-only query. It shows whether each part is active.

## 7. Lightweight local persistence

The server saves data in JSON files and limits how much it retains. It replaces each file atomically: the new version replaces the old file as one operation. Browser drafts use separate local workspace storage.

This keeps local setup simple. Runs, documents, publications, imports, and workspace state have separate data models. Those models could later use shared storage with transactions.

## 8. Explicit user actions

The interface separates actions that have different effects:

- Review and trust a connection before running queries.
- Preview an import, map its columns, and confirm it before writing data.
- Review an assistant suggestion, apply it, and run it as separate steps.
- Publish a snapshot before creating a share link.

Saved results keep their original SQL and parameters, so each user action stays clear and reviewable.

## 9. Layered testing

Different tests check different parts of the app:

- Unit tests check parsing, validation rules, storage, results, and derived views.
- Workspace tests check editor state and recovery.
- Playwright browser tests check workflows with fixed sample data.
- Integration tests check the app against the bundled ClickHouse server.

TypeScript, ESLint, coverage requirements, and production build checks provide additional checks.

## 10. Growth path

The architecture leaves room for future work in:

1. Multi-user sign-in and permissions.
2. Shared storage with transactions.
3. Managed connection secrets and organization policies.
4. More detailed tracing and diagnostics.
5. Large results, with only visible rows rendered and data delivered in streams.
6. Tests across more ClickHouse versions.

The architecture can grow to support these areas over time.
