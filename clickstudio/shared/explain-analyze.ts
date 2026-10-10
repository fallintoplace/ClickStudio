import type { ProfilePipeline, ProfilePipelineNodeKind } from './types.js';

export interface ExplainAnalyzeSummary {
    totalTime?: string;
    planningTime?: string;
    executionTime?: string;
    readRows?: string;
    readBytes?: string;
    peakMemory?: string;
}

export interface ExplainAnalyzeEvidence {
    summary: ExplainAnalyzeSummary;
    pipeline: ProfilePipeline;
}

const MAX_OUTPUT_CHARS = 2_000_000;
const MAX_OUTPUT_LINES = 8_000;
const MAX_RUNTIME_NODES = 240;

type RuntimeNode = {
    id: string;
    label: string;
    kind: ProfilePipelineNodeKind;
    detail: string[];
    durationMs?: number;
    timePercent?: number;
    parallelism?: number;
    inputRows?: string;
    outputRows?: string;
    inputBytes?: string;
    outputBytes?: string;
    parent?: string;
};

const stripFrame = (line: string) =>
    line
        .replace(/^\s*[│┃]\s?/u, '')
        .replace(/^[│┃\s]+/u, '')
        .trim();
const durationMs = (value: string): number | undefined => {
    const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*(ns|us|µs|μs|ms|s)\s*$/i);
    if (!match) return undefined;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return undefined;
    const unit = match[2]!.toLowerCase();
    const getUnitMultiplier = () => {
        switch (unit) {
            case 'ns':
                return 0.000001;

            case 'us':
            case 'µs':
            case 'μs':
                return 0.001;

            case 's':
                return 1000;

            default:
                return 1;
        }
    };
    return amount * getUnitMultiplier();
};

function nodeKind(label: string): ProfilePipelineNodeKind {
    if (/readfrom|merge.?tree|table.?scan|source/i.test(label)) return 'read';
    if (/filter|where|prewhere/i.test(label)) return 'filter';
    if (/aggregat|group.?by|distinct/i.test(label)) return 'aggregate';
    if (/sort|order.?by/i.test(label)) return 'sort';
    if (/resize|merge.*stream|merging/i.test(label)) return 'resize';
    if (/join/i.test(label)) return 'join';
    if (/output|format|result|sink|limit/i.test(label)) return 'output';
    if (/expression|projection|transform|convert/i.test(label)) return 'transform';
    return 'stage';
}

function metricNumber(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const match = text
        .replaceAll(',', '')
        .match(/^\s*(\d+(?:\.\d+)?)\s*(k|m|b|t|thousand|million|billion|trillion)?/i);
    if (!match) return undefined;
    const number = Number(match[1]);
    const suffix = (match[2] ?? '').toLowerCase();
    let factor: number;

    switch (suffix) {
        case 'k':
        case 'thousand':
            factor = 1e3;
            break;
        case 'm':
        case 'million':
            factor = 1e6;
            break;
        case 'b':
        case 'billion':
            factor = 1e9;
            break;
        case 't':
        case 'trillion':
            factor = 1e12;
            break;
        default:
            factor = 1;
            break;
    }
    const value = number * factor;
    return Number.isFinite(value) ? value : undefined;
}

function parseSummary(lines: readonly string[]): ExplainAnalyzeSummary {
    const summary: ExplainAnalyzeSummary = {};
    for (const line of lines) {
        const value = stripFrame(line);
        const time = value.match(
            /^Time:\s*(.+?)\s*\(planning\s+(.+?)\s*[·,]\s*execution\s+(.+?)\s*\)$/i,
        );
        if (time) {
            summary.totalTime = time[1]!.trim();
            summary.planningTime = time[2]!.trim();
            summary.executionTime = time[3]!.trim();
            continue;
        }
        const read = value.match(/^Read:\s*(.+)$/i);
        if (read) {
            const content = read[1]!.split(' (', 1)[0]!.trim();
            const rows = content.match(/^(.+?\s+rows?)(?:\s*,\s*(.+))?$/i);
            if (rows) {
                summary.readRows = rows[1]!.replace(/\s+rows?$/i, '').trim();
                if (rows[2]) summary.readBytes = rows[2].trim();
            }
            continue;
        }
        const memory = value.match(/^Peak memory:\s*(.+)$/i);
        if (memory) summary.peakMemory = memory[1]!.trim();
    }
    return summary;
}

function applyIo(node: RuntimeNode, value: string) {
    const sections = value.replace(/^I\/O:\s*/i, '').split(/\s+[·,]\s+/, 2);
    const pair = (section: string | undefined) =>
        section?.split(/\s*(?:→|->)\s*/, 2).map(item => item.trim());
    const rowPair = pair(sections[0] ?? '');
    if (rowPair?.length === 2 && /^rows?\b/i.test(rowPair[0]!)) {
        node.inputRows = rowPair[0]!.replace(/^rows?\s*/i, '');
        node.outputRows = rowPair[1];
    }
    const bytePair = pair(sections[1]);
    if (bytePair?.length === 2) {
        node.inputBytes = bytePair[0];
        node.outputBytes = bytePair[1];
    }
}

function applyTiming(node: RuntimeNode, value: string) {
    const time = value.match(
        /\btime\s+((?:\d+(?:\.\d+)?)\s*(?:ns|us|µs|μs|ms|s))\s*(?:\((\d+(?:\.\d+)?)%\))?/i,
    );
    if (time) {
        const elapsed = durationMs(time[1]!);
        if (elapsed !== undefined) node.durationMs = (node.durationMs ?? 0) + elapsed;
        if (time[2]) node.timePercent = Math.min(100, (node.timePercent ?? 0) + Number(time[2]));
    }
    const parallelism = value.match(/\bparallelism\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i);
    if (parallelism) {
        const average = Number(parallelism[1]);
        if (Number.isFinite(average)) node.parallelism = Math.max(node.parallelism ?? 0, average);
        node.detail.push(`Parallel capacity ${parallelism[2]}`);
    }
}

function isNodeMetadata(value: string) {
    return /^(?:Time:|Read:|Peak memory:|Output:|I\/O:|time\b|Stage\b|Keys:|Aggregates:|Skip merging:|Filter column:|Read type:|Parts:|Granules:|Indexes:|PrimaryKey\b|Skip\b|Condition:|Name:|Description:|Ranges:|Projections:|Column:)/i.test(
        value,
    );
}

function visibleText(lines: readonly string[]) {
    return lines.map(line => line.replace(/^\s*[│┃]\s?/u, '').trim()).filter(Boolean);
}

export function parseExplainAnalyze(input: unknown): ExplainAnalyzeEvidence | undefined {
    let text: string;

    if (typeof input === 'string') {
        text = input;
    } else if (Array.isArray(input)) {
        text = input
            .map(value => {
                if (typeof value === 'string') {
                    return value;
                }

                if (Array.isArray(value)) {
                    return value.map(String).join(' ');
                }

                return '';
            })
            .join('\n');
    } else {
        text = '';
    }
    if (!text.trim()) return undefined;
    const boundedText = text.slice(0, MAX_OUTPUT_CHARS);
    const allLines = boundedText.split(/\r?\n/);
    const lines = allLines.slice(0, MAX_OUTPUT_LINES);
    const summary = parseSummary(lines);
    const outputIndex = lines.findIndex(line => /^Output:/i.test(stripFrame(line)));
    const hasExplainShape =
        outputIndex >= 0 ||
        Object.values(summary).some(Boolean) ||
        lines.some(line => /^([ │]*)[├└]──/u.test(line));
    if (!hasExplainShape) return undefined;
    const scanFrom = outputIndex < 0 ? 0 : outputIndex + 1;
    const stack: RuntimeNode[] = [];
    const nodes: RuntimeNode[] = [];
    let started = false;
    let truncated = text.length > boundedText.length || allLines.length > lines.length;

    for (const line of lines.slice(scanFrom)) {
        if (/^\s*[┌┐└][─━]+(?:explain)?[─━┐┘]*\s*$/iu.test(line)) continue;
        const branch = line.match(/^([ │]*)[├└]──\s*(.*?)\s*$/u);
        const content = stripFrame(line);
        if (branch) {
            const level = Math.max(1, Math.ceil(branch[1]!.length / 3));
            const parent = stack[level - 1];
            const node: RuntimeNode = {
                id: `runtime-${nodes.length}`,
                label: branch[2]!.trim(),
                kind: nodeKind(branch[2]!.trim()),
                detail: [],
                ...(parent ? { parent: parent.id } : {}),
            };
            if (nodes.length >= MAX_RUNTIME_NODES) {
                truncated = true;
                break;
            }
            while (stack.length > level) stack.pop();
            nodes.push(node);
            stack[level] = node;
            started = true;
            continue;
        }
        if (!started) {
            if (
                !content ||
                isNodeMetadata(content) ||
                /^(?:Output|Query summary|Indexes):?$/i.test(content)
            )
                continue;
            if (/^[┌┐└├─]+$/.test(content)) continue;
            const label = content.replace(/^[│┃]\s*/u, '').trim();
            if (!label || label.length > 400) continue;
            const node: RuntimeNode = { id: 'runtime-0', label, kind: nodeKind(label), detail: [] };
            nodes.push(node);
            stack.push(node);
            started = true;
            continue;
        }
        const current = stack.at(-1);
        if (!current || !content) continue;
        const metadata = stripFrame(content);
        if (/^I\/O:/i.test(metadata)) applyIo(current, metadata);
        else if (/\btime\s+\d/i.test(metadata)) {
            const stage = metadata.match(/^Stage\s*\(([^)]+)\)\s*:/i)?.[1];
            const timing = metadata.match(
                /time\s+(\d+(?:\.\d+)?\s*(?:ns|us|µs|μs|ms|s)(?:\s*\(\d+(?:\.\d+)?%\))?)/i,
            )?.[1];
            if (timing) current.detail.push(`${stage ? `${stage}: ` : ''}${timing}`.slice(0, 180));
            applyTiming(current, metadata);
        } else if (!isNodeMetadata(metadata) && metadata.length < 400)
            current.detail.push(metadata);
    }

    if (!nodes.length && !summary.totalTime && !summary.executionTime) return undefined;
    const flowFor = (node: RuntimeNode) =>
        metricNumber(node.outputRows) ?? metricNumber(node.inputRows) ?? 0;
    const largestFlow = nodes.reduce((largest, node) => Math.max(largest, flowFor(node)), 0);
    const graphNodes = nodes.map(node => ({
        id: node.id,
        label: node.label.slice(0, 160),
        kind: node.kind,
        status: 'measured' as const,
        ...(node.detail.length
            ? { detail: node.detail.slice(0, 12).join(' · ').slice(0, 600) }
            : {}),
        ...(node.durationMs === undefined ? {} : { durationMs: node.durationMs }),
        ...(node.timePercent === undefined ? {} : { timePercent: node.timePercent }),
        ...(node.parallelism === undefined ? {} : { parallelism: node.parallelism }),
        ...(node.inputRows === undefined ? {} : { inputRows: node.inputRows }),
        ...(node.outputRows === undefined ? {} : { outputRows: node.outputRows }),
        ...(node.inputBytes === undefined ? {} : { inputBytes: node.inputBytes }),
        ...(node.outputBytes === undefined ? {} : { outputBytes: node.outputBytes }),
        ...((node.inputRows ?? node.outputRows) === undefined
            ? {}
            : { rows: node.inputRows ?? node.outputRows }),
        ...((node.inputBytes ?? node.outputBytes) === undefined
            ? {}
            : { bytes: node.inputBytes ?? node.outputBytes }),
    }));
    const edges = nodes.flatMap(node => {
        if (!node.parent) return [];
        const flow = flowFor(node);
        return [
            {
                source: node.id,
                target: node.parent,
                ...((node.outputRows && metricNumber(node.outputRows)) || node.inputRows
                    ? {
                          label: `${node.outputRows && metricNumber(node.outputRows) ? node.outputRows : node.inputRows} rows`,
                      }
                    : {}),
                ...(largestFlow <= 0
                    ? {}
                    : { flow: Math.max(0.08, Math.min(1, flow / largestFlow)) }),
            },
        ];
    });
    const pipeline: ProfilePipeline = {
        available: graphNodes.length > 0,
        source: 'explain_analyze',
        nodes: graphNodes,
        edges,
        raw: visibleText(lines).slice(0, 1000),
        ...(truncated ? { truncated: true } : {}),
        notice: 'Measured execution from EXPLAIN ANALYZE.',
    };
    return { summary, pipeline };
}
