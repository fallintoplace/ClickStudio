# AI assistant direction

This guide explores future ideas for ClickStudio. See [Project highlights](../PROJECT-STATUS.md) for features available today.

## Goal

Add AI help to the SQL workflow while keeping suggestions easy to review.

## Core actions

The assistant can help users generate, explain, repair, and review SQL. It can also help analyze results, suggest performance improvements, and propose charts.

## Context

Context is the information sent with the request. Useful context can include current SQL, selected schema objects, ClickHouse metadata, saved results, run details, query plans, and screenshots selected by the user.

The interface should show this information so the user can see what the assistant used.

## Proposal workflow

Keep these steps separate:

1. Inspect the prepared context.
2. Generate a proposal.
3. Review it.
4. Apply it to the editor.
5. Run the SQL.

This keeps the user in control of the final query.

## Quality signals

Quality checks can look at whether the proposal uses known tables and columns, stays read-only, and follows the expected output for its task.

Reusable task instructions are called playbooks. Checks can also use rules that estimate whether SQL matches the request, fixed test cases, and saved records of earlier decisions. Use these checks as review signals alongside the SQL and results.

## Product direction

More playbooks could help with query optimization, import guidance, result explanations, documentation lookup, and investigations.
