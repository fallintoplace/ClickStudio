-- ClickStudio live-query examples.
--
-- Use Run to execute all SQL, or select SQL to run only that selection.
-- Multi-statement scripts stop at the first error.
-- The active statements are read-only. The parameter example stays commented so
-- the whole file works without extra editor state.

-- 1. Table-free smoke test.
-- Works against a fresh ClickHouse server and produces chart-friendly rows.
SELECT
    toDate('2026-01-01') + toUInt32(number) AS day,
    toUInt64((number + 1) * 10) AS events
FROM numbers(7)
ORDER BY day;

-- 2. Seeded local dataset.
-- npm run db:setup creates default.events with seven deterministic rows.
SELECT
    day,
    events,
    sum(events) OVER (ORDER BY day) AS running_events
FROM default.events
ORDER BY day;

-- 3. Index-pruning example.
-- Run this statement with EXPLAIN INDEXES, EXPLAIN PLAN, or EXPLAIN PIPELINE
-- from the Run actions. default.events is ordered by day.
SELECT day, events
FROM default.events
WHERE day >= toDate('2026-01-04')
ORDER BY day;

-- 4. Exact ClickHouse values.
-- UInt64 and Decimal values must remain exact in table/export, not JS doubles.
SELECT
    toUInt64('18446744073709551615') AS exact_uint64,
    toDecimal128('12345678901234567890.12', 2) AS exact_decimal,
    CAST(NULL AS Nullable(String)) AS missing,
    ['first', 'second'] AS labels;

-- 5. Read-only schema exploration.
-- This is useful for checking that system-table access is available.
SELECT
    database,
    name,
    engine
FROM system.tables
WHERE database IN (currentDatabase(), 'system')
ORDER BY database, name
LIMIT 25;

-- 6. Named parameter binding.
-- Uncomment this statement, then provide minimum=30 in the editor parameter
-- control before running it. Values are bound on the server.
--
-- SELECT day, events
-- FROM default.events
-- WHERE events >= {minimum:UInt64}
-- ORDER BY day;
