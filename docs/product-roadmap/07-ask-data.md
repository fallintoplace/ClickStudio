# Ask Data direction

This is a product direction note. See [Project highlights](../PROJECT-STATUS.md) for implemented features.

## Goal

Turn a question written in everyday language into a SQL analysis that the user can inspect.

## Answer flow

An Ask Data workflow could:

1. Understand the question.
2. Choose relevant tables and columns.
3. Show important assumptions.
4. Generate SQL.
5. Run it with normal ClickStudio limits.
6. Show the result table.
7. Recommend a chart.
8. Explain the result.
9. Suggest follow-up actions.

## Transparency

Each answer can keep the generated SQL, parameters, source tables, query ID, result data, chart settings, and links to follow-up queries.

The user should be able to open the SQL editor at any point.

## Follow-up actions

A follow-up could change a time range, add a filter, change how rows are grouped, or choose another metric.

It could also open the generated SQL, save the answer, or publish the result. Each action should make the change clear.

## Product direction

Reusable metric definitions, schema descriptions, saved examples, and query-run details can give Ask Data better context for answering questions.
