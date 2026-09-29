# Workspace and editor direction

This is a product direction note. See [Project highlights](../PROJECT-STATUS.md) for implemented features.

## Goal

Give users a focused place to write ClickHouse SQL and understand what it does.

## Workspace

The workspace should bring SQL tabs, saved files, schema browsing, results, history, charts, EXPLAIN views, assistant context, and documentation together.

Users should be able to move between these views without losing the connection to their current SQL or saved run details.

## Editor experience

Useful editor tools include:

- Running the current statement, formatting, validation, and autocomplete.
- Column suggestions that understand table aliases, plus reusable query snippets.
- A query outline, a searchable command menu, quick navigation, and recent locations.
- Split views, saved checkpoints, and restore actions.

A checkpoint is a saved editing state that a user can return to.

## Context model

The app can group context by connection, schema, document, and selected result. It can also use playbooks: reusable instructions for common tasks.

Showing these groups helps users understand what information the assistant or another tool is using.

## Product direction

Future editor work can focus on ClickHouse tasks: inspecting plans, comparing performance, finding schema objects, reusing query patterns, creating follow-up queries from results, and looking up documentation.

SQL should remain the center of the workspace.
