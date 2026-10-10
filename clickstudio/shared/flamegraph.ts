export const MAX_FLAMEGRAPH_STACKS = 250;
export const MAX_FLAMEGRAPH_DEPTH = 32;
export const MAX_FLAMEGRAPH_NODES = 4000;

export const FLAMEGRAPH_TRACE_TYPES = ['CPU', 'Real'] as const;
export type FlamegraphTraceType = typeof FLAMEGRAPH_TRACE_TYPES[number];
export const FLAMEGRAPH_SOURCES = ['symbolized', 'addresses'] as const;
export type FlamegraphSource = typeof FLAMEGRAPH_SOURCES[number];
export function isFlamegraphSource(value: unknown): value is FlamegraphSource {
    return FLAMEGRAPH_SOURCES.some(source => source === value);
}

export interface FlamegraphFrame {
    id: string;
    name: string;
    location?: string;
    samples: number;
    selfSamples: number;
    children: FlamegraphFrame[];
}

export interface FlamegraphSeries {
    type: FlamegraphTraceType;
    root: FlamegraphFrame;
    samples: number;
}

export interface FlamegraphSnapshot {
    queryId: string;
    series: Partial<Record<FlamegraphTraceType, FlamegraphSeries>>;
    samples: Record<FlamegraphTraceType, number>;
    symbolizedSamples: number;
    truncated: boolean;
}

type Row = Record<string, unknown>;
type MutableFrame = Omit<FlamegraphFrame, 'children'> & { children: Map<string, MutableFrame> };

const safeLabel = (value: unknown) => {
    const label = Array.from(typeof value === 'string' ? value : '')
        .filter(character => {
            const code = character.codePointAt(0) ?? 0;
            return code > 0x1f && code !== 0x7f;
        })
        .join('')
        .trim()
        .slice(0, 240);
    return label === '??' || label === '<unknown>' ? '' : label;
};
const sampleCount = (value: unknown) => {
    const count = Number(value);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
};
const typeValue = (value: unknown) => FLAMEGRAPH_TRACE_TYPES.find(type => type === value);
const stringArray = (value: unknown) => Array.isArray(value) ? value : [];

export function flamegraphQuery(source: FlamegraphSource) {
    const symbols = source === 'symbolized'
        ? `arraySlice(arrayReverse(symbols), 1, ${MAX_FLAMEGRAPH_DEPTH})`
        : `arrayMap(frame -> substringUTF8(demangle(addressToSymbol(frame)), 1, 128), arraySlice(arrayReverse(trace), 1, ${MAX_FLAMEGRAPH_DEPTH}))`;
    const lines = source === 'symbolized'
        ? `arraySlice(arrayReverse(lines), 1, ${MAX_FLAMEGRAPH_DEPTH})`
        : `arrayMap(frame -> substringUTF8(addressToLine(frame), 1, 128), arraySlice(arrayReverse(trace), 1, ${MAX_FLAMEGRAPH_DEPTH}))`;
    const grouping = source === 'symbolized' ? 'trace_type, symbols, lines' : 'trace_type, trace';
    return `SELECT toString(trace_type) AS trace_type,
        arrayMap(frame -> substringUTF8(frame, 1, 128), ${symbols}) AS symbols,
        arrayMap(frame -> substringUTF8(frame, 1, 128), ${lines}) AS lines,
        count() AS samples
    FROM system.trace_log
    WHERE query_id = {queryId:String}
        AND event_date >= toDate({startDate:Date}) - 1 AND event_date <= toDate({endDate:Date}) + 1
        AND trace_type IN (${FLAMEGRAPH_TRACE_TYPES.map(type => `'${type}'`).join(', ')})
    GROUP BY ${grouping}
    ORDER BY samples DESC
    LIMIT ${MAX_FLAMEGRAPH_STACKS + 1}`;
}

function mutableRoot(type: FlamegraphTraceType): MutableFrame {
    return { id: `${type}:root`, name: type === 'CPU' ? 'CPU samples' : 'Wall-clock samples', samples: 0, selfSamples: 0, children: new Map<string, MutableFrame>() };
}

function freezeFrame(frame: MutableFrame): FlamegraphFrame {
    const children = [...frame.children.values()].map(freezeFrame).sort((left, right) => right.samples - left.samples || left.name.localeCompare(right.name) || (left.location ?? '').localeCompare(right.location ?? ''));
    return { ...frame, children };
}

export function parseFlamegraphRows(queryId: string, rows: readonly Row[]): FlamegraphSnapshot {
    const roots: Record<FlamegraphTraceType, MutableFrame> = { CPU: mutableRoot('CPU'), Real: mutableRoot('Real') };
    const samples: Record<FlamegraphTraceType, number> = { CPU: 0, Real: 0 };
    let symbolizedSamples = 0;
    let nodeCount = 2;
    let truncated = rows.length > MAX_FLAMEGRAPH_STACKS;
    for (const row of rows.slice(0, MAX_FLAMEGRAPH_STACKS)) {
        const type = typeValue(row.trace_type);
        const count = sampleCount(row.samples);
        if (!type || count === 0) continue;
        samples[type] = Math.min(Number.MAX_SAFE_INTEGER, samples[type] + count);
        const names = stringArray(row.symbols).slice(0, MAX_FLAMEGRAPH_DEPTH).map(safeLabel);
        const locations = stringArray(row.lines).slice(0, MAX_FLAMEGRAPH_DEPTH).map(safeLabel);
        const path = names.map((name, index) => ({ name, location: locations[index] || undefined })).filter(frame => frame.name.length > 0);
        if (!path.length) continue;
        symbolizedSamples = Math.min(Number.MAX_SAFE_INTEGER, symbolizedSamples + count);
        let parent = roots[type];
        parent.samples = Math.min(Number.MAX_SAFE_INTEGER, parent.samples + count);
        for (const [index, frame] of path.entries()) {
            const key = `${frame.name}\u0000${frame.location ?? ''}`;
            let child = parent.children.get(key);
            if (!child) {
                if (nodeCount >= MAX_FLAMEGRAPH_NODES) { truncated = true; break; }
                child = { id: `${type}:${nodeCount++}`, name: frame.name, location: frame.location, samples: 0, selfSamples: 0, children: new Map<string, MutableFrame>() };
                parent.children.set(key, child);
            }
            child.samples = Math.min(Number.MAX_SAFE_INTEGER, child.samples + count);
            parent = child;
            if (index === path.length - 1)
                child.selfSamples = Math.min(Number.MAX_SAFE_INTEGER, child.selfSamples + count);
        }
    }
    const series: FlamegraphSnapshot['series'] = {};
    for (const type of FLAMEGRAPH_TRACE_TYPES) {
        if (!roots[type].children.size) continue;
        series[type] = { type, root: freezeFrame(roots[type]), samples: samples[type] };
    }
    return { queryId, series, samples, symbolizedSamples, truncated };
}
