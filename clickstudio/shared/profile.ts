import type {
    ProfileInsight,
    ProfilePipeline,
    ProfilePipelineNodeKind,
    ProfileSummary,
    QueryProfile,
    Run,
} from './types.js';

type EvidenceRow = Record<string, unknown>;

const isEvidenceRow = (value: unknown): value is EvidenceRow =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const rows = (value: unknown): EvidenceRow[] =>
    Array.isArray(value) ? value.filter(isEvidenceRow) : [];
const field = (row: EvidenceRow | undefined, key: string) => row?.[key];
const numberValue = (input: unknown) => {
    const number =
        typeof input === 'number'
            ? input
            : typeof input === 'string' && input.trim()
              ? Number(input)
              : NaN;
    return Number.isFinite(number) ? number : undefined;
};
const integerText = (input: unknown) =>
    input === undefined || input === null || input === '' ? undefined : String(input);
const bigintValue = (input: unknown) => {
    const text = integerText(input);
    if (!text || !/^\d+$/.test(text)) return undefined;
    try {
        return BigInt(text);
    } catch {
        return undefined;
    }
};
const formatPercent = (part: bigint, whole: bigint) => `${Number((part * 10000n) / whole) / 100}%`;
const terminalTypes = new Set(['QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart']);

function evidenceRow(evidence: unknown, queryId: string) {
    const matching = rows(evidence).filter(row => String(field(row, 'query_id') ?? '') === queryId);
    return (
        matching.find(row => terminalTypes.has(String(field(row, 'type')))) ??
        matching[0] ??
        rows(evidence)[0]
    );
}

function summary(run: Run, evidence: unknown): ProfileSummary {
    const row = evidenceRow(evidence, run.queryId);
    return {
        durationMs: numberValue(field(row, 'query_duration_ms')) ?? run.elapsedMs,
        readRows: integerText(field(row, 'read_rows')) ?? run.progress?.readRows,
        readBytes: integerText(field(row, 'read_bytes')) ?? run.progress?.readBytes,
        resultRows: numberValue(field(row, 'result_rows')) ?? run.rowCount,
        resultBytes:
            integerText(field(row, 'result_bytes')) ?? (run.bytes ? String(run.bytes) : undefined),
        memory: integerText(field(row, 'memory_usage')) ?? run.progress?.memory,
    };
}

function insights(
    run: Run,
    profile: ProfileSummary,
    queryLogAvailable: boolean,
    hasEvidence: boolean,
): ProfileInsight[] {
    const result: ProfileInsight[] = [];
    const readRows = bigintValue(profile.readRows),
        resultRows = bigintValue(profile.resultRows);
    if (run.status === 'truncated')
        result.push({
            id: 'retained-prefix',
            severity: 'warning',
            title: 'Retained result is truncated',
            description:
                'The table, chart, and local analysis describe only the bounded retained prefix. Export and equivalence checks must treat it as incomplete.',
        });
    if (run.status === 'failed' || run.status === 'timed_out')
        result.push({
            id: 'execution-incomplete',
            severity: 'critical',
            title: 'Execution did not complete',
            description:
                'Performance numbers are partial evidence. Fix the execution error or deadline before comparing this run with another.',
        });
    if (readRows !== undefined && resultRows !== undefined && readRows > resultRows) {
        const skipped = readRows - resultRows;
        result.push({
            id: 'read-result-gap',
            severity: 'info',
            title: 'Most read rows were not returned',
            description: `${formatPercent(skipped, readRows)} of rows read did not appear in the returned result. This is a signal to inspect filtering, aggregation, and limits, not proof of a problem.`,
        });
    }
    const memory = numberValue(profile.memory),
        limit = run.limits.memory;
    if (memory !== undefined && memory >= limit * 0.8)
        result.push({
            id: 'memory-pressure',
            severity: 'warning',
            title: 'Memory approached the configured limit',
            description: `Peak memory reached ${Math.round((memory / limit) * 100)}% of the run limit. Compare joins, aggregation, and sorting before increasing the limit.`,
        });
    const readBytes = numberValue(profile.readBytes);
    if (readBytes !== undefined && readBytes >= 1024 ** 3)
        result.push({
            id: 'large-read',
            severity: 'info',
            title: 'Large read volume',
            description:
                'The query read at least 1 GiB. The next investigation should focus on MergeTree pruning, projections, and filter placement.',
        });
    if (!queryLogAvailable || !hasEvidence)
        result.push({
            id: 'limited-evidence',
            severity: 'info',
            title: 'Limited server evidence',
            description:
                'The profile falls back to live run metrics because a terminal query-log row was not available. Treat comparisons as directional.',
        });
    return result;
}

function pipelineKind(label: string): ProfilePipelineNodeKind {
    const normalized = label.toLowerCase();
    if (/readfrom|merge.?tree|numbers|table.?scan|source/.test(normalized)) return 'read';
    if (/filter|where|prewhere|condition/.test(normalized)) return 'filter';
    if (/aggregat|group.?by|distinct/.test(normalized)) return 'aggregate';
    if (/resize|merging.*(?:stream|sorted)|(?:\d+)\s*→\s*1/.test(normalized)) return 'resize';
    if (/join/.test(normalized)) return 'join';
    if (/sort|order.?by|merge.?sorting/.test(normalized)) return 'sort';
    if (/output|format|limit|sink|result/.test(normalized)) return 'output';
    if (/transform|expression|convert|projection/.test(normalized)) return 'transform';
    return 'stage';
}

const MAX_PIPELINE_DOT_CHARS = 500_000;
const MAX_PIPELINE_GRAPH_NODES = 240;
const MAX_PIPELINE_GRAPH_EDGES = 480;

type DotToken = { kind: 'value' | 'arrow' | 'punctuation'; value: string };

function tokenizeDot(source: string): { tokens: DotToken[]; truncated: boolean } {
    const input = source.slice(0, MAX_PIPELINE_DOT_CHARS);
    const tokens: DotToken[] = [];
    let index = 0;
    while (index < input.length) {
        const char = input[index]!;
        if (/\s/.test(char)) {
            index++;
            continue;
        }
        if (input.startsWith('//', index) || char === '#') {
            const end = input.indexOf('\n', index);
            index = end < 0 ? input.length : end + 1;
            continue;
        }
        if (input.startsWith('/*', index)) {
            const end = input.indexOf('*/', index + 2);
            index = end < 0 ? input.length : end + 2;
            continue;
        }
        if (input.startsWith('->', index)) {
            tokens.push({ kind: 'arrow', value: '->' });
            index += 2;
            continue;
        }
        if (char === '"') {
            index++;
            let value = '';
            while (index < input.length && input[index] !== '"') {
                if (input[index] === '\\' && index + 1 < input.length) {
                    const escaped = input[index + 1]!;
                    value +=
                        escaped === 'n' || escaped === 'l' || escaped === 'r'
                            ? '\n'
                            : escaped === 't'
                              ? '\t'
                              : escaped === '"' || escaped === '\\'
                                ? escaped
                                : `\\${escaped}`;
                    index += 2;
                } else value += input[index++]!;
            }
            if (input[index] === '"') index++;
            tokens.push({ kind: 'value', value });
            continue;
        }
        if ('{}[];,='.includes(char)) {
            tokens.push({ kind: 'punctuation', value: char });
            index++;
            continue;
        }
        const start = index;
        while (
            index < input.length &&
            !/\s/.test(input[index]!) &&
            !'{}[];,='.includes(input[index]!) &&
            !input.startsWith('->', index)
        )
            index++;
        if (start === index) index++;
        else tokens.push({ kind: 'value', value: input.slice(start, index) });
    }
    return { tokens, truncated: source.length > input.length };
}

function parsePipelineDot(
    raw: readonly string[],
    profile?: ProfileSummary,
): ProfilePipeline | undefined {
    const source = raw.join('\n');
    if (!/\bdigraph\b[\s\S]*\{/i.test(source)) return undefined;
    const { tokens, truncated: inputTruncated } = tokenizeDot(source);
    const open = tokens.findIndex(token => token.value === '{');
    if (open < 0) return undefined;
    const nodes = new Map<string, ProfilePipeline['nodes'][number]>();
    const edges: ProfilePipeline['edges'] = [];
    let i = open + 1,
        depth = 1,
        capped = inputTruncated;
    const valueAt = (at: number) => (tokens[at]?.kind === 'value' ? tokens[at]!.value : undefined);
    const readEndpoint = () => {
        const value = valueAt(i++);
        if (!value) return undefined;
        while (tokens[i]?.value === ':') {
            i++;
            if (tokens[i]?.kind === 'value') i++;
        }
        return value;
    };
    const readAttributes = () => {
        const attributes: Record<string, string> = {};
        if (tokens[i]?.value !== '[') return attributes;
        i++;
        while (i < tokens.length && tokens[i]?.value !== ']') {
            const key = valueAt(i++);
            if (!key) {
                i++;
                continue;
            }
            if (tokens[i]?.value === '=') {
                i++;
                const value = valueAt(i++);
                if (value !== undefined) attributes[key.toLowerCase()] = value;
            } else if (tokens[i]?.value !== ',' && tokens[i]?.value !== ';') i++;
        }
        if (tokens[i]?.value === ']') i++;
        return attributes;
    };
    const ensureNode = (id: string, label = id) => {
        const existing = nodes.get(id);
        const normalizedLabel = label.replace(/\s+/g, ' ').trim() || id;
        if (existing) {
            if (label !== id) {
                existing.label = normalizedLabel;
                existing.detail = label.trim();
                existing.kind = pipelineKind(normalizedLabel);
                const parallelism = /[×x*]\s*(\d+)\s*$/i.exec(normalizedLabel)?.[1];
                existing.parallelism = parallelism ? Number(parallelism) : undefined;
            }
            return existing;
        }
        const parallelism = /[×x*]\s*(\d+)\s*$/i.exec(normalizedLabel)?.[1];
        const kind = pipelineKind(normalizedLabel);
        const measured = kind === 'read' || kind === 'output';
        const node: ProfilePipeline['nodes'][number] = {
            id,
            label: normalizedLabel,
            kind,
            detail: label.trim(),
            status: 'planned',
            ...(parallelism ? { parallelism: Number(parallelism) } : {}),
            ...(measured && kind === 'read' && profile
                ? { rows: profile.readRows, bytes: profile.readBytes }
                : {}),
            ...(measured && kind === 'output' && profile
                ? {
                      durationMs: profile.durationMs,
                      rows: String(profile.resultRows),
                      bytes: profile.resultBytes,
                  }
                : {}),
        };
        if (nodes.size >= MAX_PIPELINE_GRAPH_NODES) {
            capped = true;
            return undefined;
        }
        nodes.set(id, node);
        return node;
    };

    while (i < tokens.length && depth > 0) {
        const token = tokens[i]!;
        if (token.value === '{') {
            depth++;
            i++;
            continue;
        }
        if (token.value === '}') {
            depth--;
            i++;
            continue;
        }
        if (token.value === ';' || token.value === ',') {
            i++;
            continue;
        }
        if (token.kind !== 'value') {
            i++;
            continue;
        }
        const first = token.value;
        if (
            ['graph', 'node', 'edge'].includes(first.toLowerCase()) &&
            tokens[i + 1]?.value === '['
        ) {
            i++;
            readAttributes();
            continue;
        }
        if (tokens[i + 1]?.value === '=') {
            i += 2;
            while (i < tokens.length && tokens[i]?.value !== ';' && tokens[i]?.value !== '}') i++;
            continue;
        }
        if (first.toLowerCase() === 'subgraph') {
            i++;
            if (tokens[i]?.kind === 'value') i++;
            continue;
        }

        const sourceId = readEndpoint();
        if (!sourceId) {
            i++;
            continue;
        }
        const targets: string[] = [];
        while (tokens[i]?.kind === 'arrow') {
            i++;
            const target = readEndpoint();
            if (target) targets.push(target);
        }
        const attributes = readAttributes();
        if (targets.length) {
            let previous = sourceId;
            ensureNode(sourceId);
            for (const target of targets) {
                ensureNode(target);
                if (
                    edges.length < MAX_PIPELINE_GRAPH_EDGES &&
                    nodes.has(previous) &&
                    nodes.has(target)
                )
                    edges.push({
                        source: previous,
                        target,
                        ...(attributes.label
                            ? { label: attributes.label.replace(/\s+/g, ' ').trim() }
                            : {}),
                    });
                else if (edges.length >= MAX_PIPELINE_GRAPH_EDGES) capped = true;
                previous = target;
            }
        } else if (attributes.label !== undefined) ensureNode(sourceId, attributes.label);
        else ensureNode(sourceId);
    }
    if (!nodes.size) return undefined;
    const boundedRaw = source.slice(0, 100_000);
    const notice = `Operator topology and parallel lanes come from ClickHouse EXPLAIN PIPELINE. Per-node runtime counters are not available; run metrics are shown separately.${capped ? ` The graph was bounded to ${MAX_PIPELINE_GRAPH_NODES} operators and ${MAX_PIPELINE_GRAPH_EDGES} edges.` : ''}`;
    return {
        available: true,
        source: 'explain_pipeline',
        nodes: [...nodes.values()],
        edges,
        raw: [boundedRaw],
        ...(capped ? { truncated: true } : {}),
        notice,
    };
}

function pipelineLabel(line: string) {
    return line
        .trim()
        .replace(/^[|+\-\\/<>\s]+/, '')
        .replace(/\s+[×x*]\s*\d+\s*$/, '')
        .trim();
}

function parsePipelineEvidence(
    raw: readonly string[],
    profile: ProfileSummary,
): ProfilePipeline | undefined {
    const graph = parsePipelineDot(raw, profile);
    if (graph) return graph;
    const lines = raw.flatMap(line => line.replace(/\r/g, '').split('\n')).slice(0, 160);
    const nodes: ProfilePipeline['nodes'] = [],
        edges: ProfilePipeline['edges'] = [];
    const stack: Array<{ indent: number; id: string }> = [];
    for (const line of lines) {
        if (!line.trim() || /^\s*(header|processors?)\s*:/i.test(line)) continue;
        const indent = line.search(/\S|$/);
        const label = pipelineLabel(line);
        if (!label || /^header\b/i.test(label)) continue;
        while (stack.at(-1)?.indent !== undefined && stack.at(-1)!.indent >= indent) stack.pop();
        const id = `pipeline-${nodes.length + 1}`;
        const kind = pipelineKind(label);
        const measured = kind === 'read' || kind === 'output';
        nodes.push({
            id,
            label,
            kind,
            detail: line.trim(),
            status: measured ? 'measured' : 'estimated',
            ...(kind === 'read' ? { rows: profile.readRows, bytes: profile.readBytes } : {}),
            ...(kind === 'output'
                ? {
                      durationMs: profile.durationMs,
                      rows: String(profile.resultRows),
                      bytes: profile.resultBytes,
                  }
                : {}),
        });
        const parent = stack.at(-1)?.id;
        if (parent) edges.push({ source: parent, target: id });
        stack.push({ indent, id });
    }
    if (!nodes.length) return undefined;
    return {
        available: true,
        source: 'explain_pipeline',
        nodes,
        edges,
        raw: [...raw],
        notice: 'Processor stages come from ClickHouse EXPLAIN PIPELINE. Runtime counters are attached where the query log provides them.',
    };
}

function queryShapePipeline(run: Run, profile: ProfileSummary): ProfilePipeline {
    const sourceMatch = /\b(?:from|join)\s+([`"A-Za-z0-9_.]+)/i.exec(run.sql);
    const source = sourceMatch?.[1]?.replace(/[`"]+/g, '') ?? 'query source';
    const nodes: ProfilePipeline['nodes'] = [
        {
            id: 'shape-read',
            label: `Read ${source}`,
            kind: 'read',
            status: 'measured',
            rows: profile.readRows,
            bytes: profile.readBytes,
        },
    ];
    const add = (id: string, label: string, kind: ProfilePipelineNodeKind) =>
        nodes.push({ id, label, kind, status: 'estimated' });
    const sql = run.sql.toLowerCase();
    if (/\b(prewhere|where)\b/.test(sql)) add('shape-filter', 'Filter / PREWHERE', 'filter');
    if (/\b(group\s+by|count\s*\(|sum\s*\(|avg\s*\(|uniq\s*\(|distinct)\b/.test(sql))
        add('shape-aggregate', 'Aggregate', 'aggregate');
    if (/\b(order\s+by|limit)\b/.test(sql)) add('shape-sort', 'Sort / limit', 'sort');
    nodes.push({
        id: 'shape-output',
        label: 'Return result',
        kind: 'output',
        status: 'measured',
        durationMs: profile.durationMs,
        rows: String(profile.resultRows),
        bytes: profile.resultBytes,
    });
    return {
        available: true,
        source: 'query_shape',
        nodes,
        edges: nodes.slice(1).map((node, index) => ({ source: nodes[index]!.id, target: node.id })),
        notice: 'This is a query-shape sketch based on the SQL and measured run counters. Inspect the pipeline to replace it with ClickHouse processor evidence.',
    };
}

function buildPipeline(
    run: Run,
    profile: ProfileSummary,
    options: { pipelineAvailable: boolean; pipelineEvidence?: readonly string[] },
): ProfilePipeline {
    if (options.pipelineAvailable && options.pipelineEvidence?.length) {
        const parsed = parsePipelineEvidence(options.pipelineEvidence, profile);
        if (parsed) return parsed;
    }
    return queryShapePipeline(run, profile);
}

export function buildQueryProfile(
    run: Run,
    evidence: unknown,
    options: {
        queryLogAvailable: boolean;
        pipelineAvailable: boolean;
        pipelineEvidence?: readonly string[];
        traceUrl?: string;
        notice: string;
    },
): QueryProfile {
    const current = summary(run, evidence);
    const pipeline = buildPipeline(run, current, options);
    return {
        version: 1,
        queryId: run.queryId,
        runId: run.id,
        summary: current,
        insights: insights(
            run,
            current,
            options.queryLogAvailable,
            Boolean(evidenceRow(evidence, run.queryId)),
        ),
        pipeline,
        capabilities: {
            queryLog: options.queryLogAvailable,
            pipelineGraph: options.pipelineAvailable,
            indexAnalysis: false,
            runtimePlan: false,
        },
        evidence,
        traceUrl: options.traceUrl,
        notice: options.notice,
    };
}

export function parsePipelineResult(raw: readonly string[]): ProfilePipeline | undefined {
    return parsePipelineDot(raw, undefined);
}
