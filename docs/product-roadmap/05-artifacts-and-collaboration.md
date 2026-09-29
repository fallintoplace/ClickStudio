# Saved analysis and collaboration

This guide explores future ideas for ClickStudio. See [Project highlights](../PROJECT-STATUS.md) for features available today.

## Goal

Make useful analysis easy to save, revisit, publish, and extend.

## Core artifact model

An artifact is a saved item of work. Examples include query documents, revisions, runs, results, charts, publications, shared links, metric definitions, and monitors.

Each item can keep a link to its source SQL and query run. A revision is a saved version of a document. A metric definition describes how a measure is calculated.

## Revision workflow

A document can move through these stages:

1. Edit a local draft.
2. Save a revision.
3. Run the SQL and keep the run details.
4. Publish a snapshot of the result.
5. Share a view of that snapshot.

A snapshot preserves a saved result while the draft can continue to change. These stages show reviewers what they will see.

## Collaboration direction

Future collaboration could add owner and editor roles, comments, revision history, collections, review states, shared result views, reusable datasets, schedules, and monitors.

## Lineage

Lineage means the links from a saved item back to the work that produced it.

From a chart or published answer, a reviewer should be able to find the query, parameters, run, result snapshot, and connection details.

These links make shared analysis easier to check and repeat.
