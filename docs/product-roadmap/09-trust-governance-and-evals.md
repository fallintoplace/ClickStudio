# Trust, permissions, and quality checks

This guide explores future ideas for ClickStudio. See [Project highlights](../PROJECT-STATUS.md) for features available today.

## Goal

Make queries, assistant actions, and sharing easy to inspect and manage.

## Execution trust

Useful run details include query IDs, connection identity, server-side limits, SQL, parameters, the age of a result, links to saved revisions, and query tags.

These details help explain which data and settings produced an answer.

## Assistant governance

Governance means rules and records for how the assistant is used. A workflow can show the prepared context, requested model action, proposal details, quality-check results, apply decisions, and playbook version.

A playbook is a reusable set of task instructions. Recording its version helps explain which instructions shaped a proposal.

Configuration for sensitive columns and credentials kept on the server can make data handling easier to understand and control.

## Evaluation

Evaluation means testing behavior with repeatable cases. A test suite can check whether the assistant uses known tables and columns, generates or repairs SQL, explains results, gives performance guidance, and reviews a draft as expected.

It can also test ClickHouse-version compatibility and browser workflows.

## Product direction

Future work could add organization policies, audit views, approval steps, more diagnostic information, and team dashboards for quality results.

Important actions should keep enough context to explain what happened and repeat the work.
