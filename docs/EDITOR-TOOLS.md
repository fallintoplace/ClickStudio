# SQL editing tools

Use these tools to navigate SQL scripts, add query patterns, and complete names as you type.

## Query navigation

The numbered query navigator previews each SQL statement.

- Choose **Previous / next**, or press **Alt+PageUp / Alt+PageDown**, to move between statements.
- Choose **Select query** to select the current statement. You can then use the run-selection action.

Navigation and query execution share a lexer, the code that recognizes SQL text and statement boundaries. It handles comments, escaped quotes, and heredocs, which are strings between matching delimiter markers.

The outline updates when you edit the document, so its statement locations stay aligned with the SQL.

## ClickHouse snippets

A snippet is an editable query template. Choose one and press **Add query** to place it at the end of the document.

The templates include hourly counts, top values, P50/P95/P99 percentiles, the latest value per key with `argMax`, conditional counts, and `EXPLAIN indexes = 1`. A percentile describes a value's position in a distribution; for example, P50 is the median.

Press **Tab / Shift+Tab** to move between placeholder fields. When a placeholder appears more than once, changing one copy updates the linked copies. The editor's normal undo action also works with snippet insertion.

The same templates appear in autocomplete with names that start with `ch_`.

## Completion

Autocomplete suggests SQL keywords, ClickHouse functions, schema names and types, function descriptions, table aliases, and tables with database-qualified names.

For example, typing `e.` offers columns from the table with alias `e`. Typing `database.` offers tables from that database.

Suggestions account for quoted names, comments, strings, and the statement you are editing.

## Sample and live workflows

Try the tools in the sample workspace with repeatable example responses. Connect to a live ClickHouse server to run SQL with the same editor tools.

## Validation

From the repository root, run:

```sh
cd clickstudio
npm run test:core
npm run typecheck
npm run test:e2e -- tests/e2e/editor-tools.spec.ts
```

The tests cover statement boundaries, snippet insertion, placeholder navigation, aliases, completion positions, large schemas, keyboard navigation, undo, and keyword completion.
