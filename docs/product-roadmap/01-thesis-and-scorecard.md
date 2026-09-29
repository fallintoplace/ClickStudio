# Product goal and success measures

This guide explores future ideas for ClickStudio. See [Project highlights](../PROJECT-STATUS.md) for features available today.

## Vision

Build a SQL workspace designed for ClickHouse. Keep queries, results, performance information, and assistant suggestions connected.

The product goal is:

> Go from a question to a useful ClickHouse result. Understand each step and keep enough information to repeat the analysis.

## Product character

The workspace should combine a fast editor with clear query history, interactive plans, performance measurements, and results that users can save and reuse.

Users should be able to review AI suggestions before applying them and use the keyboard for common actions. The interface should start simply and reveal more detailed tools when needed.

## Primary user

The main user is a technical analyst or data engineer who needs to:

1. Write SQL.
2. Run it.
3. Inspect the results.
4. Understand how the query ran.
5. Improve the query.
6. Save or share the analysis.

## Technology direction

The current technology stack supports this workflow:

| Technology | Main role |
| --- | --- |
| React, TypeScript, and Vite | Build and develop the web interface. |
| Click UI and Tailwind CSS | Provide interface components and styling. |
| CodeMirror 6 | Edit SQL. |
| Express 5 | Handle server API requests. |
| TanStack Query | Manage data requests in the interface. |
| ECharts | Draw charts. |
| `@clickhouse/client` | Connect the server to ClickHouse. |
| OpenAI SDK | Call the optional AI model. |
| OpenTelemetry | Record diagnostic traces. |
| Docker Compose | Run the local services. |
| Playwright and unit tests | Check browser workflows and individual parts of the app. |

## ClickHouse-native advantage

ClickStudio can use ClickHouse features directly: `system.databases`, `system.tables`, `system.columns`, query IDs, live progress, cancellation, query history, and server documentation.

`EXPLAIN INDEXES`, `EXPLAIN PLAN`, and `EXPLAIN PIPELINE` can help users understand how ClickHouse processes a query. This gives the app more useful database detail than a generic SQL connection alone.

## Success signals

A useful experience should make it easy to write the first query, understand its columns and values, and turn its result into a chart or follow-up query.

Users should also be able to understand a plan, compare saved run details, review an assistant suggestion with its context, and reopen an analysis with its SQL and run details intact.
