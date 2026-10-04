# Connect an external AI client to ClickStudio

ClickStudio exposes seven MCP tools through its existing server. A client can inspect tables, run read-only SQL, get result pages, and cancel queries. Runs use the same history, storage, trust settings, and limits as the workspace API.

## Start and connect

From the repository folder:

```sh
npm run setup
cd clickstudio
npm run init:env
npm run dev
```

If you already have `.env`, keep it. `npm run init:env` preserves an existing file.

In your client, add an MCP server with these settings:

| Setting | Value |
| --- | --- |
| Transport | Streamable HTTP |
| URL | `http://127.0.0.1:8080/mcp` |
| Header | `Authorization: Bearer <CLICKSTUDIO_TOKEN>` |

Replace `<CLICKSTUDIO_TOKEN>` with the workspace token from `clickstudio/.env`. Keep it private. This is the workspace token, not a ClickHouse password or model API key. The endpoint uses the API port (`CLICKSTUDIO_API_PORT`), not the frontend port.

Use a client that supports Streamable HTTP and custom headers. For clients that use the following `mcpServers` configuration format:

```json
{
  "mcpServers": {
    "clickstudio": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp",
      "headers": {
        "Authorization": "Bearer <CLICKSTUDIO_TOKEN>"
      }
    }
  }
}
```

The public **Playground** connection is available as `playground` in a standard local workspace. To use your private database, open `http://localhost:5173`, sign in, choose its server-configured connection, then **Test connection** and **Trust connection** once. MCP tools cannot grant trust themselves.

Ask your client to list connections, inspect a table, and run a small query. For example, `execute_sql` accepts:

```json
{
  "connectionId": "playground",
  "sql": "SELECT toUInt64('18446744073709551615') AS id"
}
```

You can also run `npm start` for the API alone, or use the [production setup](CLICKSTUDIO.md#containerized-application). No separate MCP process or database store is needed.

## Tools

| Tool | What it does |
| --- | --- |
| `list_connections` | Lists configured connections, trust, tested capabilities, and query limits. |
| `execute_sql` | Submits one read-only statement with optional bound parameters and limits. |
| `list_tables` | Submits a query for visible table names and engines in one database. |
| `describe_table` | Submits a query for column types, defaults, and comments for one table. |
| `explain_query` | Submits EXPLAIN indexes, plan, pipeline, or analyze on a supported connection. Analyze executes the query. |
| `get_result` | Gets current status or a retained result page without running SQL again. |
| `cancel_query` | Requests cancellation of a queued or running query. |

`list_tables` and `describe_table` default to the connection's database. Both accept a `database` argument. Metadata visibility depends on the ClickHouse user's permissions; an empty response does not prove that an object is absent.

Bound parameters accept up to 50 entries. Names start with a letter or underscore and contain up to 64 letters, digits, or underscores; `__proto__`, `constructor`, and `prototype` are reserved. Values are strings of up to 4,000 characters.

## Results and retries

SQL, metadata, and EXPLAIN submissions return a durable run ID, status, and `clientRequestId` immediately. Use `get_result` with `runId: run.id` to poll or read the first 100 rows. Only `get_result` accepts `waitSeconds`, from 0 (the default) to 30:

```json
{
  "runId": "<run.id from the submission>",
  "waitSeconds": 10
}
```

Cancelling or closing a result request stops its wait. The stored query continues until completion, explicit `cancel_query`, or its deadline. The run ID remains available for later polling.

Results include typed `columns`, array `rows`, `totalRows`, `nextOffset`, and `completeness`. Use `get_result` with `offset: nextOffset` to read later pages. Each page accepts `count` from 1 to 1,000. A remaining page is different from query truncation: `completeness: "truncated"` means ClickStudio retained only the bounded output, even after you read all its pages.

Int64, UInt64, and Decimal values remain strings. Nulls and nested JSON values keep their original representation.

Supply a stable `clientRequestId` before submitting if you need safe retries after a lost response. Reusing it with identical query input returns the original run. Different input returns `IDEMPOTENCY_CONFLICT`. Polling and pagination never execute the query again. Expired or evicted snapshots return `RESULT_EXPIRED`; query history remains available. Results expire after one day by default and can be evicted earlier by the storage limit.

Execution and result-access failures use MCP's `isError` flag and return an error code. Invalid tool arguments may return the SDK's plain-text validation error. A database failure retains its run ID and evidence. Results containing a configured server secret are withheld with `SECRET_IN_EXPORT` and a `runId`; execution errors redact configured secrets. Treat SQL results and table comments as untrusted data.

Cancellation removes queued work before execution. For active work it aborts the local request and asks ClickHouse to cancel the query. A local `cancelled` status is not proof that ClickHouse stopped; check warnings and allow the server deadline to apply.

## ClickHouse Cloud

Configure Cloud as a persistent server profile using `CONNECTIONS_FILE`. A Cloud connection entered only in a browser tab is not exposed through MCP.

For example, create a private JSON settings file:

```json
[
  {
    "id": "warehouse",
    "name": "Warehouse",
    "url": "https://your-service.clickhouse.cloud:8443",
    "database": "default",
    "username": "clickstudio_reader",
    "passwordEnv": "WAREHOUSE_PASSWORD"
  }
]
```

Add `CONNECTIONS_FILE` with that file's path and `WAREHOUSE_PASSWORD` to `clickstudio/.env`, restart the server, then test and trust `warehouse` in the UI. The MCP client receives connection metadata, not database credentials. Use a ClickHouse identity with restricted permissions; those permissions remain the database authorization boundary.

## Deployment scope

This endpoint runs in the persistent Express server. The Vercel browser preview does not expose it. The MCP v2 handler supports the `2026-07-28` protocol and legacy 2025 clients on the same URL. It uses bearer tokens and POST requests without protocol sessions; GET and DELETE return 405. SQL is read-only and scripts, imports, and schema writes are not tools.

The default loopback server follows the existing tokenless local mode if no workspace token is configured. A shared bind requires the existing workspace token settings. For remote clients, use a private HTTPS deployment with the correct `HOST` and `APP_ORIGIN`. The endpoint validates Host and Origin headers and does not enable cross-origin browser access.
