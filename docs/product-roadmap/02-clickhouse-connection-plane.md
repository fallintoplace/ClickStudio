# ClickHouse connections

This guide explores future ideas for ClickStudio. See [Project highlights](../PROJECT-STATUS.md) for features available today.

## Goal

Make ClickHouse connections easy to set up while keeping the details needed to understand each query run.

## Connection profiles

A connection profile is a named group of connection settings. It can include the server URL, database, reader user, import writer user, execution limits, and information about supported features.

The browser selects a profile ID. The server owns the credentials and connection details.

## Details for each run

Each run can keep its query ID, SQL, parameters, row and byte limits, timeout, memory limit, and thread settings.

It can also keep the connection identity, links to the source document, and query tags. Keeping these details in one model helps execution, history, plans, results, and cancellation work together.

## Discovering supported features

A connection can report which features are available. This feature list can cover schema browsing, scripts, parameters, progress, cancellation, query-log records, imports, EXPLAIN views, and native documentation.

The interface can then show the features supported by that connection.

## Product direction

Future work could include saved profiles, ClickHouse Cloud presets, profiles managed by a team, integration with a secret manager, environment labels, and more detailed rules for query execution.

The main design stays the same: the server manages the profile, and each run uses a consistent set of saved details.
