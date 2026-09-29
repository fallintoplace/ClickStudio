# Project highlights

ClickStudio is a ClickHouse SQL editor built as an interview project. It is designed to run locally. It focuses on useful SQL workflows, ClickHouse-specific tools, and clear records of query execution.

## Implemented capabilities

### Write and run queries

Run read-only queries with server-side limits and query IDs. Run multi-statement scripts and inspect a separate result for each statement.

The CodeMirror editor supports formatting, validation, parameters, tabs, and recovery of workspace state.

### Explore data and performance

Browse schemas and database objects, including ClickHouse system-table documentation. View typed results, filter data, export results, build charts, and revisit saved query history.

Use **EXPLAIN INDEXES**, **EXPLAIN PLAN**, **EXPLAIN PIPELINE**, and **EXPLAIN ANALYZE** views. Runtime analysis requires a server that supports it.

Inspect active and inactive MergeTree parts in a horizontal partition map, treemap, or circle layout.

### Import and save work

Import CSV, JSON, or NDJSON with a preview, column mapping, and explicit confirmation. Imports use a separate database user with write permissions.

Save query revisions and publish result snapshots with size limits. Optional assistant suggestions have separate review, apply, and run steps.

### Try and test the app

Sample mode uses fixed example responses for a repeatable tour of the interface. The project has unit, workspace, browser, and live ClickHouse integration tests.

## Technical focus

The main areas to review are:

1. Queries go through the server rather than directly from the browser to the database.
2. Saved results belong to a specific query run.
3. Exact ClickHouse numbers keep their precision when passed to JavaScript.
4. ClickHouse permissions enforce database access.
5. Fixed sample responses support repeatable tests.
6. EXPLAIN output becomes interactive graphs while raw output remains available.
7. Local file storage keeps setup simple.
8. Tests cover individual functions, browser workflows, and live database integration.

See [Engineering choices](ENGINEERING-NOTES.md) for the reasons behind these decisions.

## Product shape

The current app is designed for one owner and local use. It uses lightweight storage and explicitly configured connections.

This keeps setup simple and makes the main SQL workflow easy to review. Shared storage, organization-level permissions, managed connections, and larger-result workflows are possible future extensions.

The [product exploration notes](product-roadmap/) describe ideas for future work. They are separate from the implemented features above.

## Running and validating

Start with the [repository README](../README.md). Use the [setup and implementation reference](CLICKSTUDIO.md) for detailed behavior and configuration.

The GitHub Actions workflow at [`.github/workflows/clickstudio.yml`](../.github/workflows/clickstudio.yml) runs the project's quality and integration checks.
