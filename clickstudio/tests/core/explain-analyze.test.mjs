import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExplainAnalyze } from '../../.core-build/src/frontend/workspace/queries/inspection/performance/explain-analyze.js';

const output = `┌─explain────────────────────────────────────────────────────────────┐
│ Query summary:
│   Time:        29.32 ms (planning 1.74 ms · execution 27.58 ms)
│   Read:        22.67 million rows, 22.67 MB (822.00 million rows/s.)
│   Peak memory: 42.13 MiB
│
│ Output: count()
│
│ Expression ((Project names + Projection))
│ │  I/O: rows 1 → 1 · 8 B → 8 B
│ │    time 1.33 us (0.0%) · parallelism 0.94/1
│ └──Aggregating
│    │  Keys:
│    │  Aggregates: count()
│    │  I/O: rows 82 → 1 (1.22%) · 0 B → 8 B
│    │    Stage (partial aggregation): time 100.30 us (0.4%) · parallelism 0.96/12
│    │    Stage (final aggregation): time 2.83 us (0.0%) · parallelism 1.00/1
│    └──Expression (Before GROUP BY)
│       │  I/O: rows 82 → 82
│       │    time 16.87 us (0.1%) · parallelism 0.60/12
│       └──Filter
│          │  I/O: rows 22.67 million → 82 (0.00%) · 22.67 MB → 0 B
│          │    time 2.68 ms (9.7%) · parallelism 2.24/12
│          └──ReadFromMergeTree (default.hackernews)
│                Read type: Default
│                Parts: 6 | Granules: 3533
│                I/O: rows 0 → 22.67 million · 0 B → 22.67 MB
│                  time 27.18 ms (98.6%) · parallelism 11.59/12
└───────────────────────────────────────────────────────────────────┘`;

test('Native EXPLAIN ANALYZE output becomes summary metrics and a measured data-flow graph', () => {
    const evidence = parseExplainAnalyze(output);
    assert.ok(evidence);
    assert.deepEqual(evidence.summary, {
        totalTime: '29.32 ms',
        planningTime: '1.74 ms',
        executionTime: '27.58 ms',
        readRows: '22.67 million',
        readBytes: '22.67 MB',
        peakMemory: '42.13 MiB',
    });
    assert.equal(evidence.pipeline.source, 'explain_analyze');
    assert.equal(evidence.pipeline.nodes.length, 5);

    const aggregate = evidence.pipeline.nodes.find(node => node.kind === 'aggregate');
    assert.ok(aggregate);
    assert.ok(Math.abs(aggregate.durationMs - 0.10313) < 0.00001);
    assert.equal(aggregate.timePercent, 0.4);
    assert.equal(aggregate.parallelism, 1);
    assert.match(aggregate.detail, /partial aggregation/);
    assert.match(aggregate.detail, /final aggregation/);

    const read = evidence.pipeline.nodes.find(node => node.kind === 'read');
    assert.ok(read);
    assert.equal(read.inputRows, '0');
    assert.equal(read.outputRows, '22.67 million');
    assert.equal(read.outputBytes, '22.67 MB');
    assert.equal(read.durationMs, 27.18);
    assert.equal(read.timePercent, 98.6);
    assert.equal(read.parallelism, 11.59);
    assert.deepEqual(evidence.pipeline.edges.at(-1), {
        source: read.id,
        target: evidence.pipeline.nodes.find(node => node.kind === 'filter').id,
        label: '22.67 million rows',
        flow: 1,
    });
});

test('Parser tolerates unknown future operators and summary-only output', () => {
    const future = parseExplainAnalyze(
        `Query summary:\nTime: 2 ms (planning 1 ms · execution 1 ms)\nOutput: x\n└──NewProcessor (future)`,
    );
    assert.ok(future);
    assert.equal(future.pipeline.nodes[0].label, 'NewProcessor (future)');
    assert.equal(future.pipeline.nodes[0].kind, 'stage');

    const summaryOnly = parseExplainAnalyze(
        'Query summary:\nTime: 2 ms (planning 1 ms · execution 1 ms)',
    );
    assert.ok(summaryOnly);
    assert.equal(summaryOnly.pipeline.nodes.length, 0);
    assert.equal(summaryOnly.summary.executionTime, '1 ms');
});

test('Parser skips framing borders and rejects malformed output safely', () => {
    const evidence = parseExplainAnalyze(output);
    assert.ok(evidence);
    assert.equal(
        evidence.pipeline.nodes.some(
            node => node.label.startsWith('┌') || node.label.startsWith('─'),
        ),
        false,
    );
    for (const value of [
        undefined,
        null,
        '',
        'not a ClickHouse explain',
        '{}',
        ' '.repeat(2_000_001),
    ])
        assert.equal(parseExplainAnalyze(value), undefined);
});

test('Runtime graph node count is bounded and reports truncation', () => {
    const operators = Array.from({ length: 300 }, (_, index) => `└──FutureOperator${index}`).join(
        '\n',
    );
    const evidence = parseExplainAnalyze(`Output: x\nRoot\n${operators}`);
    assert.ok(evidence);
    assert.equal(evidence.pipeline.nodes.length, 240);
    assert.equal(evidence.pipeline.truncated, true);
});

test('Parser accepts line and row arrays without coercing unrelated values', () => {
    const ignored = {
        toString() {
            throw new Error('Unrelated values must not be coerced');
        },
    };
    const expected = parseExplainAnalyze(output);
    const lines = output.split('\n');
    for (const input of [lines, lines.map(line => [line]), [...lines, ignored, null, 42]]) {
        const actual = parseExplainAnalyze(input);
        assert.deepEqual(actual.summary, expected.summary);
        assert.deepEqual(actual.pipeline.nodes, expected.pipeline.nodes);
        assert.deepEqual(actual.pipeline.edges, expected.pipeline.edges);
    }
    assert.equal(parseExplainAnalyze(ignored), undefined);
});

for (const duration of ['1000000 ns', '1000 us', '1000 µs', '1000 μs', '1 ms', '0.001 s']) {
    test(`Runtime timing normalizes ${duration} to milliseconds`, () => {
        const evidence = parseExplainAnalyze(`Output: x\nRoot\n  time ${duration}`);
        assert.equal(evidence.pipeline.nodes[0].durationMs, 1);
    });
}

for (const [suffix, factor] of [
    ['k', 1e3],
    ['m', 1e6],
    ['million', 1e6],
    ['b', 1e9],
    ['billion', 1e9],
    ['t', 1e12],
    ['trillion', 1e12],
]) {
    test(`Runtime graph compares ${suffix} row counts with unscaled counts`, () => {
        const evidence = parseExplainAnalyze(
            `Output: x\nRoot\n└──ReadFirst\n  I/O: rows 0 → 2 ${suffix}\n└──ReadSecond\n  I/O: rows 0 → ${factor}`,
        );
        assert.equal(evidence.pipeline.edges[0].flow, 1);
        assert.equal(evidence.pipeline.edges[1].flow, 0.5);
    });
}
