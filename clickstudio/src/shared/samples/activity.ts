import { parseFlamegraphRows, type FlamegraphSnapshot } from '../queries/inspection/flamegraph.js';
import type { ReplicationSnapshot } from '../database/explorer/activity/replication.js';
import type { WorkloadSnapshot, WorkloadWindow } from '../database/explorer/activity/workload.js';

const families: WorkloadSnapshot['families'] = [
    {
        hash: '13871280199445720',
        query: 'SELECT country, count() FROM demo.events WHERE event_time >= ? GROUP BY country',
        executions: 284,
        p50Ms: 18,
        p95Ms: 92,
        p99Ms: 184,
        totalMs: 8_914,
        readRows: '18400000',
        readBytes: '2218400000',
        peakMemory: '248512512',
        errors: 2,
        lastSeen: '2026-09-25 15:42:10',
    },
    {
        hash: '5820142839501703',
        query: 'SELECT channel, sum(total) FROM demo.orders WHERE order_time >= ? GROUP BY channel',
        executions: 142,
        p50Ms: 36,
        p95Ms: 218,
        p99Ms: 372,
        totalMs: 7_621,
        readRows: '6010000',
        readBytes: '964000000',
        peakMemory: '387973120',
        errors: 0,
        lastSeen: '2026-09-25 15:39:48',
    },
    {
        hash: '12084202271452780',
        query: 'SELECT toStartOfHour(event_time), count() FROM demo.events GROUP BY 1 ORDER BY 1',
        executions: 96,
        p50Ms: 68,
        p95Ms: 174,
        p99Ms: 261,
        totalMs: 6_402,
        readRows: '28800000',
        readBytes: '3467200000',
        peakMemory: '531628032',
        errors: 1,
        lastSeen: '2026-09-25 15:36:27',
    },
    {
        hash: '7704831291843012',
        query: 'SELECT user_id, max(started_at) FROM demo.sessions GROUP BY user_id LIMIT ?',
        executions: 41,
        p50Ms: 112,
        p95Ms: 428,
        p99Ms: 611,
        totalMs: 8_115,
        readRows: '7540000',
        readBytes: '1206400000',
        peakMemory: '713031680',
        errors: 0,
        lastSeen: '2026-09-25 15:31:03',
    },
];

export function demoWorkload(connectionId: string, minutes: WorkloadWindow): WorkloadSnapshot {
    const points = Array.from({ length: 140 }, (_, index) => {
        const family = families[index % families.length]!;
        const durationMs = Math.max(
            4,
            Math.round(
                family.p50Ms + ((index * 47 + index * index * 7) % Math.max(12, family.p95Ms * 2)),
            ),
        );
        const at = new Date(
            Date.now() - ((index * 7919) % Math.max(1, minutes * 60_000)),
        ).toISOString();
        return {
            hash: family.hash,
            queryId: `fixture-${index + 1}`,
            at,
            durationMs,
            memory: String(
                Math.round(Number(family.peakMemory) * (0.18 + ((index * 13) % 72) / 100)),
            ),
            readRows: String(Math.round(Number(family.readRows) / family.executions)),
            readBytes: String(Math.round(Number(family.readBytes) / family.executions)),
            failed: index % 31 === 0,
        };
    }).sort((left, right) => right.at.localeCompare(left.at));
    return {
        connectionId,
        minutes,
        scope: 'local-user',
        queryLogSource: 'query_log',
        families: families.map(family => ({ ...family })),
        points,
        truncated: false,
    };
}

export function demoReplication(connectionId: string): ReplicationSnapshot {
    return {
        connectionId,
        scope: 'local-node',
        capabilities: { replicas: true, queue: true },
        replicas: [
            {
                database: 'demo',
                table: 'events_local',
                replicaName: 'sample-replica-1',
                leader: true,
                readonly: false,
                sessionExpired: false,
                absoluteDelay: 0,
                queueSize: 2,
                insertsInQueue: 1,
                mergesInQueue: 1,
                futureParts: 2,
                totalReplicas: 3,
                activeReplicas: 3,
            },
            {
                database: 'demo',
                table: 'orders_local',
                replicaName: 'sample-replica-1',
                leader: false,
                readonly: false,
                sessionExpired: false,
                absoluteDelay: 12,
                queueSize: 4,
                insertsInQueue: 1,
                mergesInQueue: 2,
                futureParts: 3,
                totalReplicas: 3,
                activeReplicas: 2,
            },
            {
                database: 'demo',
                table: 'sessions_local',
                replicaName: 'sample-replica-1',
                leader: true,
                readonly: true,
                sessionExpired: true,
                absoluteDelay: 184,
                queueSize: 18,
                insertsInQueue: 0,
                mergesInQueue: 0,
                futureParts: 0,
                totalReplicas: 2,
                activeReplicas: 1,
            },
        ],
        queue: [
            {
                database: 'demo',
                table: 'events_local',
                type: 'GET_PART',
                entries: 1,
                oldestAt: '2026-09-25 15:39:04',
                maxTries: 1,
                errors: 0,
                postponed: 0,
                executing: 1,
            },
            {
                database: 'demo',
                table: 'events_local',
                type: 'MERGE_PARTS',
                entries: 1,
                oldestAt: '2026-09-25 15:40:30',
                maxTries: 0,
                errors: 0,
                postponed: 0,
                executing: 0,
            },
            {
                database: 'demo',
                table: 'orders_local',
                type: 'GET_PART',
                entries: 3,
                oldestAt: '2026-09-25 15:31:52',
                maxTries: 2,
                errors: 1,
                postponed: 1,
                executing: 0,
            },
            {
                database: 'demo',
                table: 'orders_local',
                type: 'MERGE_PARTS',
                entries: 1,
                oldestAt: '2026-09-25 15:38:18',
                maxTries: 0,
                errors: 0,
                postponed: 0,
                executing: 0,
            },
            {
                database: 'demo',
                table: 'sessions_local',
                type: 'GET_PART',
                entries: 18,
                oldestAt: '2026-09-25 12:21:14',
                maxTries: 19,
                errors: 4,
                postponed: 11,
                executing: 0,
            },
        ],
        truncated: false,
    };
}

export function demoFlamegraph(queryId: string): FlamegraphSnapshot {
    return parseFlamegraphRows(queryId, [
        {
            trace_type: 'CPU',
            symbols: [
                'DB::executeQuery',
                'DB::InterpreterSelectQuery::execute',
                'DB::Aggregator::executeOnBlock',
            ],
            lines: [
                'src/Interpreters/executeQuery.cpp:842',
                'src/Interpreters/InterpreterSelectQuery.cpp:312',
                'src/Interpreters/Aggregator.cpp:1042',
            ],
            samples: 142,
        },
        {
            trace_type: 'CPU',
            symbols: [
                'DB::executeQuery',
                'DB::InterpreterSelectQuery::execute',
                'DB::MergeTreeReader::readRows',
            ],
            lines: [
                'src/Interpreters/executeQuery.cpp:842',
                'src/Interpreters/InterpreterSelectQuery.cpp:312',
                'src/Storages/MergeTree/MergeTreeReader.cpp:511',
            ],
            samples: 76,
        },
        {
            trace_type: 'CPU',
            symbols: [
                'DB::executeQuery',
                'DB::InterpreterSelectQuery::execute',
                'DB::Aggregator::executeOnBlock',
                'DB::HashMap::emplace',
            ],
            lines: [
                'src/Interpreters/executeQuery.cpp:842',
                'src/Interpreters/InterpreterSelectQuery.cpp:312',
                'src/Interpreters/Aggregator.cpp:1042',
                'src/Common/HashTable/HashMap.h:380',
            ],
            samples: 38,
        },
        {
            trace_type: 'Real',
            symbols: [
                'DB::executeQuery',
                'DB::InterpreterSelectQuery::execute',
                'DB::MergeTreeReader::readRows',
            ],
            lines: [
                'src/Interpreters/executeQuery.cpp:842',
                'src/Interpreters/InterpreterSelectQuery.cpp:312',
                'src/Storages/MergeTree/MergeTreeReader.cpp:511',
            ],
            samples: 213,
        },
        {
            trace_type: 'Real',
            symbols: [
                'DB::executeQuery',
                'DB::InterpreterSelectQuery::execute',
                'DB::Aggregator::executeOnBlock',
            ],
            lines: [
                'src/Interpreters/executeQuery.cpp:842',
                'src/Interpreters/InterpreterSelectQuery.cpp:312',
                'src/Interpreters/Aggregator.cpp:1042',
            ],
            samples: 104,
        },
    ]);
}
