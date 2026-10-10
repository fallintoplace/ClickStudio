import type { ProfilePipeline, ProfilePipelineNode } from './types.js';

export type ExplainIndexCount = { selected: string; total: string; percent: number };
export type ExplainIndexStep = {
    id: string;
    type: string;
    name?: string;
    parts?: ExplainIndexCount;
    granules?: ExplainIndexCount;
    properties: Array<{ name: string; value: string }>;
};
export type ExplainIndexAnalysis = {
    pipeline: ProfilePipeline;
    steps: Map<string, ExplainIndexStep>;
    indexCount: number;
    truncated: boolean;
};

type ExplainLine = { indent: number; text: string };
type IndexSection = { source: string; steps: ExplainIndexStep[] };

const MAX_EXPLAIN_CHARS = 1_000_000;
const MAX_GRAPH_NODES = 120;
const MAX_GRAPH_SECTIONS = Math.floor(MAX_GRAPH_NODES / 3);
const MAX_INDEX_PROPERTIES = 40;
const MAX_PROPERTY_CHARS = 4_000;

function explainLines(rows: readonly (readonly unknown[])[]) {
    let remaining = MAX_EXPLAIN_CHARS;
    let truncated = false;
    const lines: ExplainLine[] = [];
    for (const row of rows) {
        const value = row[0];
        if (typeof value !== 'string') continue;
        if (value.length > remaining) {
            truncated = true;
            lines.push(
                ...value
                    .slice(0, remaining)
                    .split(/\r?\n/)
                    .map(explainLine)
                    .filter((line): line is ExplainLine => Boolean(line)),
            );
            break;
        }
        remaining -= value.length;
        lines.push(
            ...value
                .split(/\r?\n/)
                .map(explainLine)
                .filter((line): line is ExplainLine => Boolean(line)),
        );
    }
    return { lines, truncated };
}

function explainLine(value: string): ExplainLine | undefined {
    const deNumbered = value.replace(/^\s*\d+\.\s*[│|]\s?/, '');
    const indentText = deNumbered.match(/^\s*/)?.[0] ?? '';
    const text = deNumbered
        .slice(indentText.length)
        .replace(/\s*[│|]\s*$/, '')
        .trimEnd();
    if (!text.trim() || /^[┌┐└┘├┤┬┴┼─━│┃┆┊║]+$/.test(text.trim())) return undefined;
    return { indent: indentText.length, text: text.trim() };
}

function ratio(value: string): ExplainIndexCount | undefined {
    const match = value.match(/(?:^|\D)(\d[\d,_]*)\s*\/\s*(\d[\d,_]*)(?:\D|$)/);
    if (!match) return undefined;
    const selected = match[1]!.replace(/[,_]/g, '');
    const total = match[2]!.replace(/[,_]/g, '');
    try {
        const selectedValue = BigInt(selected),
            totalValue = BigInt(total);
        if (totalValue <= 0n || selectedValue > totalValue) return undefined;
        const percent = Number((selectedValue * 1000n + totalValue / 2n) / totalValue) / 10;
        return { selected, total, percent };
    } catch {
        return undefined;
    }
}

function property(index: ExplainIndexStep, name: string, value: string) {
    if (index.properties.length >= MAX_INDEX_PROPERTIES) return;
    index.properties.push({ name: name.slice(0, 160), value: value.slice(0, MAX_PROPERTY_CHARS) });
    if (name.toLowerCase() === 'parts') index.parts = ratio(value);
    if (name.toLowerCase() === 'granules') index.granules = ratio(value);
    if (name.toLowerCase() === 'name' && value.trim()) index.name = value.trim().slice(0, 160);
}

function sourceLabel(lines: ExplainLine[], before: number) {
    for (let index = before; index >= 0; index--) {
        if (
            /\bReadFrom(?:MergeTree|Merge|Remote|File|S3|URL|MySQL|PostgreSQL|SQLite|Bifurcate|Dictionary|Null|Numbers|System|Values|View)\b/i.test(
                lines[index]!.text,
            )
        )
            return lines[index]!.text.slice(0, 240);
        if (/^Indexes\s*:/i.test(lines[index]!.text)) return 'Table read';
    }
    return 'Table read';
}

function indexSteps(lines: ExplainLine[], truncatedInput: boolean) {
    const sections: IndexSection[] = [];
    let truncated = truncatedInput;
    let parsedIndexCount = 0;
    for (let cursor = 0; cursor < lines.length; cursor++) {
        if (parsedIndexCount >= MAX_GRAPH_NODES) {
            truncated = true;
            break;
        }
        const heading = lines[cursor]!;
        if (!/^Indexes\s*:/i.test(heading.text)) continue;
        if (sections.length >= MAX_GRAPH_SECTIONS) {
            truncated = true;
            break;
        }
        const section: IndexSection = { source: sourceLabel(lines, cursor - 1), steps: [] };
        let entryIndent: number | undefined;
        let current: ExplainIndexStep | undefined;
        let collectingKeys = false;
        let keys: string[] = [];
        const finishKeys = () => {
            if (!current || !keys.length) return;
            property(current, 'Keys', keys.join(', '));
            keys = [];
        };
        for (let lineIndex = cursor + 1; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex]!;
            if (line.indent <= heading.indent) break;
            if (
                /^Indexes\s*:/i.test(line.text) ||
                /\bReadFrom(?:MergeTree|Merge|Remote|File|S3|URL|MySQL|PostgreSQL|SQLite|Bifurcate|Dictionary|Null|Numbers|System|Values|View)\b/i.test(
                    line.text,
                )
            )
                break;
            const separator = line.text.indexOf(':');
            if (separator >= 0) {
                if (!current) continue;
                const name = line.text.slice(0, separator).trim();
                const value = line.text.slice(separator + 1).trim();
                if (name.toLowerCase() === 'keys') {
                    finishKeys();
                    collectingKeys = true;
                    if (value) keys.push(value);
                    continue;
                }
                finishKeys();
                collectingKeys = false;
                property(current, name, value);
                continue;
            }
            if (entryIndent === undefined || line.indent <= entryIndent) {
                finishKeys();
                collectingKeys = false;
                entryIndent = line.indent;
                if (parsedIndexCount >= MAX_GRAPH_NODES) {
                    truncated = true;
                    break;
                }
                current = {
                    id: `index-${sections.length}-${section.steps.length}`,
                    type: line.text.slice(0, 160),
                    properties: [],
                };
                section.steps.push(current);
                parsedIndexCount++;
                continue;
            }
            if (collectingKeys) keys.push(line.text);
            else if (current) {
                const previous = current.properties.at(-1);
                if (previous)
                    previous.value = `${previous.value}\n${line.text}`.slice(0, MAX_PROPERTY_CHARS);
                else property(current, 'Details', line.text);
            }
        }
        finishKeys();
        if (section.steps.length) sections.push(section);
    }
    return { sections, truncated };
}

function graphStatus(step: ExplainIndexStep) {
    if (!step.granules) return undefined;
    return `${step.granules.percent}% remain`;
}

export function parseExplainIndexAnalysis(
    rows: readonly (readonly unknown[])[],
): ExplainIndexAnalysis | undefined {
    const { lines, truncated: truncatedInput } = explainLines(rows);
    if (!lines.some(line => /^Indexes\s*:/i.test(line.text))) return undefined;
    const { sections, truncated } = indexSteps(lines, truncatedInput);
    if (!sections.length) return undefined;

    const nodes: ProfilePipelineNode[] = [];
    const edges: ProfilePipeline['edges'] = [];
    const steps = new Map<string, ExplainIndexStep>();
    let indexCount = 0;
    let graphTruncated = truncated;
    for (const [sectionIndex, section] of sections.entries()) {
        if (nodes.length + 3 > MAX_GRAPH_NODES) {
            graphTruncated = true;
            break;
        }
        const readId = `index-read-${sectionIndex}`;
        nodes.push({ id: readId, label: section.source, kind: 'read', status: 'planned' });
        let previousId = readId;
        const availableChecks = Math.max(0, MAX_GRAPH_NODES - nodes.length - 1);
        const visibleSteps = section.steps.slice(0, availableChecks);
        for (const step of visibleSteps) {
            const id = step.id;
            const label = step.name ?? step.type;
            nodes.push({ id, label, kind: 'filter', status: 'planned', detail: graphStatus(step) });
            edges.push({ source: previousId, target: id });
            previousId = id;
            steps.set(id, step);
            indexCount++;
        }
        if (visibleSteps.length < section.steps.length) graphTruncated = true;
        const outputId = `index-output-${sectionIndex}`;
        nodes.push({
            id: outputId,
            label: 'Read selected granules',
            kind: 'output',
            status: 'planned',
        });
        edges.push({ source: previousId, target: outputId });
        if (visibleSteps.length < section.steps.length) break;
    }
    return {
        pipeline: {
            available: true,
            source: 'explain_plan',
            nodes,
            edges,
            truncated: graphTruncated,
            notice: 'Index pruning facts are reported by ClickHouse EXPLAIN INDEXES.',
        },
        steps,
        indexCount,
        truncated: graphTruncated,
    };
}
