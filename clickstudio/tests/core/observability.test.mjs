import test from 'node:test';
import assert from 'node:assert/strict';
import {
    flamegraphQuery,
    MAX_FLAMEGRAPH_DEPTH,
    MAX_FLAMEGRAPH_NODES,
    MAX_FLAMEGRAPH_STACKS,
    parseFlamegraphRows,
} from '../../.core-build/src/shared/queries/inspection/flamegraph.js';
import {
    parseReplicationSnapshot,
    replicationQueueQuery,
    replicationReplicasQuery,
} from '../../.core-build/src/shared/database/explorer/activity/replication.js';
import {
    WORKLOAD_WINDOWS,
    parseWorkloadSnapshot,
    workloadFamiliesQuery,
    workloadPointsQuery,
} from '../../.core-build/src/shared/database/explorer/activity/workload.js';

test('workload SQL reads only the selected user query log and keeps both result sets bounded', () => {
    for (const source of ['user_query_log', 'query_log']) {
        const families = workloadFamiliesQuery(source);
        const points = workloadPointsQuery(source);
        for (const sql of [families, points]) {
            assert.match(sql, new RegExp(`FROM system\\.${source}`));
            assert.match(sql, /event_time >= now\(\) - toIntervalMinute\(\{minutes:UInt16\}\)/);
            assert.match(sql, /user = \{username:String\} AND is_initial_query = 1/);
            assert.match(sql, /query_id NOT LIKE 'clickstudio-inspect-%'/);
            assert.match(sql, /LIMIT (?:101|501)$/);
        }
    }
    assert.deepEqual(WORKLOAD_WINDOWS, [15, 60, 360, 1440]);
    assert.match(workloadFamiliesQuery('query_log'), /LIMIT 101$/);
    assert.match(workloadPointsQuery('query_log'), /type != 'QueryFinish' AS failed/);
    assert.doesNotMatch(workloadFamiliesQuery('query_log'), /clusterAllReplicas|cluster\(/i);
});

test('workload parsing preserves large byte counters, sanitizes query text, and reports overflow rows', () => {
    const query = `SELECT ${'x'.repeat(300)}\n FROM events`;
    const families = Array.from({ length: 101 }, (_, index) => ({
        hash: String(index),
        query,
        executions: '9',
        p50_ms: '2.5',
        p95_ms: '9',
        p99_ms: '12',
        total_ms: '40',
        read_rows: '18446744073709551615',
        read_bytes: '18446744073709551615',
        peak_memory: '9007199254740993',
        errors: '2',
        last_seen: '2026-09-26 10:00:00',
    }));
    const points = Array.from({ length: 501 }, (_, index) => ({
        hash: '1',
        query_id: `query-${index}`,
        at: '2026-09-26 10:00:00',
        duration_ms: '8',
        memory: '9007199254740993',
        read_rows: '18446744073709551615',
        read_bytes: '18446744073709551615',
        failed: index % 2,
    }));
    const snapshot = parseWorkloadSnapshot('local', 60, 'user_query_log', families, points);
    assert.equal(snapshot.families.length, 100);
    assert.equal(snapshot.points.length, 500);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.families[0].query.length, 240);
    assert.equal(snapshot.families[0].readBytes, '18446744073709551615');
    assert.equal(snapshot.points[0].memory, '9007199254740993');
    assert.equal(snapshot.points[0].failed, false);
    assert.equal(snapshot.points[1].failed, true);
    assert.equal(parseWorkloadSnapshot('local', 15, 'query_log', [], []).truncated, false);
});

test('flamegraph SQL supports persisted symbols and older address translation with bounded query dates', () => {
    const persisted = flamegraphQuery('symbolized');
    const addresses = flamegraphQuery('addresses');
    assert.match(persisted, /arrayReverse\(symbols\)/);
    assert.match(persisted, /arrayReverse\(lines\)/);
    assert.match(persisted, /GROUP BY trace_type, symbols, lines/);
    assert.match(addresses, /demangle\(addressToSymbol\(frame\)\)/);
    assert.match(addresses, /addressToLine\(frame\)/);
    assert.match(addresses, /GROUP BY trace_type, trace/);
    for (const sql of [persisted, addresses]) {
        assert.match(sql, /query_id = \{queryId:String\}/);
        assert.match(sql, /event_date >= toDate\(\{startDate:Date\}\) - 1/);
        assert.match(sql, new RegExp(`LIMIT ${MAX_FLAMEGRAPH_STACKS + 1}$`));
    }
    assert.equal(MAX_FLAMEGRAPH_DEPTH, 32);
});

test('flamegraph parser merges shared stack prefixes and preserves CPU and wall-clock samples', () => {
    const snapshot = parseFlamegraphRows('run-query', [
        {
            trace_type: 'CPU',
            symbols: ['DB::query', 'DB::read', 'DB::decode'],
            lines: ['q.cpp:1', 'r.cpp:2'],
            samples: 3,
        },
        {
            trace_type: 'CPU',
            symbols: ['DB::query', 'DB::read', 'DB::filter'],
            lines: ['q.cpp:1', 'r.cpp:2', 'f.cpp:3'],
            samples: 2,
        },
        {
            trace_type: 'Real',
            symbols: ['DB::query', 'DB::wait'],
            lines: ['q.cpp:1', 'w.cpp:8'],
            samples: 7,
        },
        { trace_type: 'Memory', symbols: ['ignored'], lines: ['ignored.cpp:1'], samples: 999 },
    ]);
    assert.equal(snapshot.queryId, 'run-query');
    assert.deepEqual(snapshot.samples, { CPU: 5, Real: 7 });
    assert.equal(snapshot.symbolizedSamples, 12);
    assert.equal(snapshot.series.CPU.root.children[0].name, 'DB::query');
    assert.equal(snapshot.series.CPU.root.children[0].samples, 5);
    assert.equal(snapshot.series.CPU.root.children[0].children[0].samples, 5);
    assert.equal(snapshot.series.CPU.root.children[0].children.length, 1);
    assert.equal(snapshot.truncated, false);
});

test('flamegraph parser ignores unresolved frames and bounds deep or oversized stack input', () => {
    const unresolved = parseFlamegraphRows('q', [
        { trace_type: 'CPU', symbols: ['??', '', '<unknown>'], lines: ['??'], samples: 4 },
    ]);
    assert.equal(unresolved.samples.CPU, 4);
    assert.equal(unresolved.symbolizedSamples, 0);
    assert.equal(unresolved.series.CPU, undefined);

    const deep = Array.from({ length: MAX_FLAMEGRAPH_DEPTH + 12 }, (_, index) => `frame-${index}`);
    const rows = Array.from({ length: MAX_FLAMEGRAPH_STACKS + 1 }, (_, index) => ({
        trace_type: 'CPU',
        symbols: deep.map(name => `${name}-${index}`),
        lines: [],
        samples: 1,
    }));
    const bounded = parseFlamegraphRows('q', rows);
    assert.equal(bounded.truncated, true);
    assert.equal(bounded.samples.CPU, MAX_FLAMEGRAPH_STACKS);
    let deepest = bounded.series.CPU.root;
    let depth = 0;
    while (deepest.children[0]) {
        deepest = deepest.children[0];
        depth++;
    }
    assert.equal(depth, MAX_FLAMEGRAPH_DEPTH);
});

test('flamegraph parser caps node growth and ignores malformed sample counts', () => {
    const unique = Array.from({ length: MAX_FLAMEGRAPH_STACKS + 1 }, (_, index) => ({
        trace_type: 'CPU',
        symbols: Array.from(
            { length: MAX_FLAMEGRAPH_DEPTH },
            (_, depth) => `frame-${index}-${depth}`,
        ),
        lines: [],
        samples: index === 0 ? 'bad' : 1,
    }));
    const snapshot = parseFlamegraphRows('q', unique);
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.samples.CPU, MAX_FLAMEGRAPH_STACKS - 1);
    assert.equal(snapshot.symbolizedSamples, MAX_FLAMEGRAPH_STACKS - 1);
    const countNodes = frame =>
        1 + frame.children.reduce((count, child) => count + countNodes(child), 0);
    assert.equal(countNodes(snapshot.series.CPU.root), MAX_FLAMEGRAPH_NODES - 1);
});

test('replication queries stay node-local and bounded', () => {
    assert.match(replicationReplicasQuery(), /FROM system\.replicas/);
    assert.match(replicationReplicasQuery(), /LIMIT 501$/);
    assert.match(replicationQueueQuery(), /FROM system\.replication_queue/);
    assert.match(replicationQueueQuery(), /GROUP BY database, table, type/);
    assert.match(replicationQueueQuery(), /LIMIT 501$/);
    assert.doesNotMatch(
        `${replicationReplicasQuery()} ${replicationQueueQuery()}`,
        /clusterAllReplicas|cluster\(/i,
    );
});

test('replication parsing normalizes flags, rejects incomplete identities, and reports bounded results', () => {
    const replicaRows = Array.from({ length: 501 }, (_, index) => ({
        database: 'db',
        table: `table-${index}`,
        replica_name: 'replica-a',
        is_leader: index % 2,
        is_readonly: 0,
        is_session_expired: 'false',
        absolute_delay: String(index),
        queue_size: '3',
        inserts_in_queue: 1,
        merges_in_queue: 2,
        future_parts: 4,
        total_replicas: 3,
        active_replicas: 2,
    }));
    const queueRows = [
        {
            database: 'db',
            table: 'table-0',
            type: 'GET_PART',
            entries: '5',
            oldest_at: '2026-09-26 10:00:00',
            max_tries: '2',
            errors: '1',
            postponed: '3',
            executing: '0',
        },
        { database: '', table: 'invalid', type: 'GET_PART', entries: 1 },
    ];
    const snapshot = parseReplicationSnapshot(
        'local',
        { replicas: true, queue: true },
        replicaRows,
        queueRows,
    );
    assert.equal(snapshot.replicas.length, 500);
    assert.equal(snapshot.queue.length, 1);
    assert.equal(snapshot.replicas[1].leader, true);
    assert.equal(snapshot.replicas[0].sessionExpired, false);
    assert.equal(snapshot.queue[0].postponed, 3);
    assert.equal(snapshot.truncated, true);
    assert.equal(
        parseReplicationSnapshot('local', { replicas: false, queue: false }, [], []).scope,
        'local-node',
    );
});
