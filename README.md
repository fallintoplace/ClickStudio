# ClickStudio

ClickStudio is a SQL editor for ClickHouse. Use it to write queries, view results, build charts, and inspect query performance.

Each saved run keeps its SQL, parameters, limits, results, and run details together. Reopen it to see how ClickHouse returned the result.

The app uses React, Click UI, and CodeMirror. The server limits query time, memory use, and result size.

## Review ClickStudio

The fastest way to try the app is sample mode. It needs no database.

1. Follow the [sample setup](#sample-workspace) below.
2. Try the editor, results, charts, and query plan views.
3. Read [Engineering choices](docs/ENGINEERING-NOTES.md) to learn how the app works.
4. Read [Project highlights](docs/PROJECT-STATUS.md) to see what is included.

You can also run SQL on a real data source:

- **ClickHouse Playground** uses public data. It is read-only and needs no account.
- **ClickHouse Cloud** uses your own service. Choose **Connect ClickHouse Cloud** in the data source menu and enter the HTTPS host, database, username, and password from your Cloud service.

The Cloud password stays in this browser tab’s memory. ClickStudio sends it to the ClickStudio server, which connects to Cloud over HTTPS. The password is cleared when you reload the page or disconnect. Your ClickHouse user’s permissions control what you can read or change.

![Data source menu with ClickHouse Cloud and ClickHouse Playground](docs/images/reviewer-data-sources.png)

*Choose the public Playground or connect your own ClickHouse Cloud service.*

## Quick start

You need **Node.js 22.12 or newer** and npm. You need Docker only if you want to run the local ClickHouse server.

Run the commands from the repository folder that contains this README, unless a step says to enter the clickstudio folder.

### Sample workspace

Use sample mode to try the app without a database:

    npm run setup
    cd clickstudio
    DEMO_MODE=true npm run dev

Open http://localhost:5173 and choose **Start exploring**.

Sample mode shows fixed example results. It does not run your SQL on a database. To run real SQL, choose **ClickHouse Playground** or connect to **ClickHouse Cloud** in the data source menu.

### AI assistant

The AI assistant needs an OpenAI API key. Sample mode does not enable AI. Use the normal server mode for this section.

Create the local settings file:

If you already ran npm run setup above, skip that command. If clickstudio/.env already exists, skip npm run init:env.

    npm run setup
    cd clickstudio
    npm run init:env

Open the .env file in the clickstudio folder and add your key:

    OPENAI_API_KEY=your-openai-api-key

You can leave OPENAI_MODEL empty to use the default model. Or set a model that your OpenAI account can use.

Start the app:

    npm run dev

When ClickStudio asks you to sign in, use the CLICKSTUDIO_TOKEN value from clickstudio/.env. Then choose **ClickHouse Playground** or connect to your Cloud service. Open the **AI** tab and follow the prompts to load the schema.

The key stays on the server. Do not put it in a variable that starts with VITE_; those values are sent to the browser. Do not commit the .env file. Git ignores it.

The AI panel explains what it sends and saves. This can include your message, chat history, SQL, table and column names, and recent query results. SQL suggestions do not run until you choose to run them.

![AI panel in the workspace](docs/images/reviewer-ai-panel.png)

*The AI panel is available after you set an OpenAI key and connect to a data source.*

### Local ClickHouse

Use these steps if you want to run a local ClickHouse server with Docker:

Skip npm run setup if you already ran it above. Skip npm run init:env if clickstudio/.env already exists.

    npm run setup
    cd clickstudio
    npm run init:env
    docker compose up -d --wait clickhouse
    npm run db:setup
    npm run dev

Then:

1. Open http://localhost:5173.
2. Sign in with the CLICKSTUDIO_TOKEN value from clickstudio/.env.
3. Choose **Test connection**.
4. Choose **Trust connection**. Enter local when asked.

The setup adds sample data to default.events. Try this query:

    SELECT day, events
    FROM default.events
    ORDER BY day;

The menu beside **Run statement** has **EXPLAIN INDEXES**, **EXPLAIN PLAN**, **EXPLAIN PIPELINE**, and **EXPLAIN ANALYZE**.

**EXPLAIN ANALYZE runs the selected query.** It needs ClickHouse 26.7 or newer. The bundled server is version 24.6, so this option is not available with that server.

### Example files

These files are used by the local setup:

- [analysis.sql](clickstudio/examples/analysis.sql): example queries, parameters, and query plans.
- [import.csv](clickstudio/examples/import.csv): sample rows for default.import_events.
- [connections.json](clickstudio/examples/connections.json): settings for more than one connection.

## Main features

- **Write SQL.** Format and check queries. Run one query or a script with results for each statement.
- **Explore data.** Browse databases, tables, columns, system docs, and MergeTree data parts.
- **View results.** See column types and result pages. Build charts and save query documents.
- **Import files.** Preview CSV, JSON, and NDJSON files. Map columns and check the row count before import.
- **Inspect query runs.** Track progress, cancel queries, reopen run details, and view query plans and runtime charts.
- **Use the AI assistant.** Review the information sent to AI and its SQL suggestion before you apply or run it.

## Checks

Run the main project checks:

    npm run check

This checks the code, runs tests, and builds the app.

To run the main browser checks:

    cd clickstudio
    npm run test:e2e:core

For ClickHouse integration checks, start the local database first. Then run:

    cd clickstudio
    CLICKHOUSE_INTEGRATION=1 npm run test:integration
    npm run eval

## More guides

- [Docs index](docs/README.md): all guides and a glossary.
- [Engineering choices](docs/ENGINEERING-NOTES.md): how the app is built.
- [Project highlights](docs/PROJECT-STATUS.md): current features and scope.
- [Setup and implementation guide](docs/CLICKSTUDIO.md): setup, settings, and details.
- [Product ideas](docs/product-roadmap/): possible future work.
