import type { ProfilePipeline, QueryProfile, Run } from './types.js';
import { metadataInteger, type MetadataRow } from './native-metadata.js';

export interface ComparisonMetric {
    label: string;
    before?: string;
    after?: string;
    unit: 'count' | 'bytes' | 'ms';
    source: string;
    neutral?: boolean;
}
export function comparableRun(run: Run, connectionId: string): boolean {
    return (
        run.connectionId === connectionId &&
        run.kind === 'query' &&
        (run.status === 'succeeded' || run.status === 'truncated')
    );
}
function terminalEvidence(run: Run, profile?: QueryProfile): MetadataRow | undefined {
    if (
        profile?.runId !== run.id ||
        profile.queryId !== run.queryId ||
        !Array.isArray(profile.evidence)
    )
        return undefined;
    return profile.evidence.find((value: unknown): value is MetadataRow =>
        Boolean(
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            (value as MetadataRow).query_id === run.queryId &&
            (value as MetadataRow).type === 'QueryFinish',
        ),
    );
}
const sortedObject = (value: object) =>
    JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));

export function compareRuns(
    before: Run,
    after: Run,
    beforeProfile?: QueryProfile,
    afterProfile?: QueryProfile,
) {
    const a = terminalEvidence(before, beforeProfile),
        b = terminalEvidence(after, afterProfile);
    const warnings: string[] = [];
    const sameContext =
        before.connectionId === after.connectionId && before.dataSource === after.dataSource;
    if (!sameContext)
        warnings.push(
            'These runs have different connections or data sources; percentage deltas are disabled.',
        );
    if (before.id === after.id) warnings.push('Select two different runs.');
    if (!comparableRun(before, before.connectionId) || !comparableRun(after, after.connectionId))
        warnings.push('Only completed query runs should be compared.');
    if (before.status === 'truncated' || after.status === 'truncated')
        warnings.push('A result was truncated. Retained row counts are not full result counts.');
    if (sortedObject(before.parameters) !== sortedObject(after.parameters))
        warnings.push('Query parameters differ.');
    if (sortedObject(before.limits) !== sortedObject(after.limits))
        warnings.push('Configured query limits differ.');
    if (before.serverVersion && after.serverVersion && before.serverVersion !== after.serverVersion)
        warnings.push('Server versions differ.');
    warnings.push(
        'This is a comparison of individual runs, not a controlled benchmark. Cache state, data, and concurrent load may differ.',
    );
    const metrics: ComparisonMetric[] = [];
    const pair = (
        label: string,
        field: string,
        unit: ComparisonMetric['unit'],
        fallbackA?: string,
        fallbackB?: string,
        fallbackSource = 'Run progress',
    ) => {
        const left = metadataInteger(a?.[field]),
            right = metadataInteger(b?.[field]);
        if (left !== undefined && right !== undefined)
            metrics.push({
                label,
                before: left,
                after: right,
                unit,
                source: 'Matched terminal query-log rows',
            });
        else if (fallbackA !== undefined && fallbackB !== undefined)
            metrics.push({
                label,
                before: fallbackA,
                after: fallbackB,
                unit,
                source: fallbackSource,
            });
        else
            metrics.push({
                label,
                before: left,
                after: right,
                unit,
                source: 'Terminal query-log evidence incomplete',
            });
    };
    pair(
        'Duration',
        'query_duration_ms',
        'ms',
        metadataInteger(Math.round(before.elapsedMs)),
        metadataInteger(Math.round(after.elapsedMs)),
        'Client-observed elapsed time',
    );
    pair(
        'Rows read',
        'read_rows',
        'count',
        metadataInteger(before.progress?.readRows),
        metadataInteger(after.progress?.readRows),
    );
    pair(
        'Bytes read',
        'read_bytes',
        'bytes',
        metadataInteger(before.progress?.readBytes),
        metadataInteger(after.progress?.readBytes),
    );
    pair('Peak memory', 'memory_usage', 'bytes');
    metrics.push({
        label: 'Retained result rows',
        before: metadataInteger(before.rowCount),
        after: metadataInteger(after.rowCount),
        unit: 'count',
        source: 'Retained run metadata · equal counts do not prove equal results',
        neutral: true,
    });
    return {
        metrics,
        warnings,
        deltasEnabled:
            sameContext &&
            before.id !== after.id &&
            comparableRun(before, before.connectionId) &&
            comparableRun(after, after.connectionId),
    };
}
export function comparisonDelta(
    before?: string,
    after?: string,
): { text: string; direction: 'down' | 'up' | 'equal' | 'unknown' } {
    const left = metadataInteger(before),
        right = metadataInteger(after);
    if (left === undefined || right === undefined)
        return { text: 'Unavailable', direction: 'unknown' };
    const a = BigInt(left),
        b = BigInt(right);
    if (a === b) return { text: 'No change', direction: 'equal' };
    const direction = b < a ? 'down' : 'up';
    if (a === 0n) return { text: 'Increase from zero', direction };
    const tenths = ((b > a ? b - a : a - b) * 1000n) / a;
    return {
        text: `${direction === 'down' ? '↓' : '↑'} ${tenths / 10n}.${tenths % 10n}%`,
        direction,
    };
}
export function comparePipelineOperators(before: ProfilePipeline, after: ProfilePipeline) {
    const inventory = (pipeline: ProfilePipeline) => {
        const result = new Map<string, number>();
        for (const node of pipeline.nodes)
            result.set(node.label, (result.get(node.label) ?? 0) + 1);
        return result;
    };
    const left = inventory(before),
        right = inventory(after);
    return [...new Set([...left.keys(), ...right.keys()])]
        .sort()
        .map(label => ({ label, before: left.get(label) ?? 0, after: right.get(label) ?? 0 }))
        .filter(row => row.before !== row.after);
}
