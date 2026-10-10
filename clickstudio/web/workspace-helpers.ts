import type { ApiError, Run } from '../shared/types';
import { recommendGeo } from '../shared/geo';
import type { NativeParseSnapshot } from '../shared/native-parser';
import { selectedStatement, splitSql } from '../shared/sql';
import { message, RequestError } from './api';
import type { EditorHandle } from './components/SqlEditor';
import type { Copy, ExperienceLevel } from './i18n';
import type { Connected, ResultsView } from './workspace-types';

export function safeSelectedStatement(sql: string, from: number, to: number) {
    try {
        return selectedStatement(sql, from, to);
    } catch {
        return undefined;
    }
}

export function safeStatementCount(sql: string) {
    try {
        return splitSql(sql).length;
    } catch {
        return undefined;
    }
}

export type HelpStatement = { sql: string; from: number };

export function helpStatementSql(statement: HelpStatement | undefined, fallback: string) {
    return statement?.sql ?? fallback;
}

export function helpStatementOffset(statement: HelpStatement | undefined) {
    return statement?.from ?? 0;
}

export function helpParseResult<T>(statement: { result: T } | undefined) {
    return statement?.result;
}

export function revealEditorRange(
    editor: { current: EditorHandle | null },
    from: number,
    to: number,
) {
    editor.current?.revealRange(from, to);
}

export function insertEditorText(editor: { current: EditorHandle | null }, value: string) {
    editor.current?.insert(value);
}

export function focusEditor(editor: { current: EditorHandle | null }) {
    editor.current?.focus();
}

export function helpParseDuration(snapshot: NativeParseSnapshot | undefined) {
    return snapshot?.elapsedMs;
}

export function helpQueryLogAvailable(connection: Connected) {
    return connection.manifest?.queryLog.available === true;
}

export type FailedQueryError = {
    draftId: string;
    draftSql: string;
    statementSql: string;
    sourceFrom: number;
    error: ApiError;
};

export function resultsViews(
    run: Run | undefined,
    experience: ExperienceLevel,
): readonly ResultsView[] {
    if (experience === 'beginner')
        return run?.kind === 'query' ? ['results', 'chart'] : ['results'];
    if (run?.kind === 'explain') return ['results', 'indexes'];
    if (run?.kind === 'plan') return ['results', 'plan'];
    if (run?.kind === 'pipeline') return ['results', 'pipeline'];
    if (run?.kind === 'analyze') return ['results', 'runtime'];
    const tabs: ResultsView[] = ['results', 'chart', 'sqlmap', 'insights'];
    if (run?.kind === 'query' && recommendGeo(run.columns)) tabs.splice(2, 0, 'map');
    return tabs;
}

export function resultsViewTitle(view: ResultsView, copy: Copy['common']): string {
    switch (view) {
        case 'sqlmap':
            return copy.sqlStructure;
        case 'map':
            return copy.map;
        case 'indexes':
            return copy.explain;
        case 'plan':
            return copy.logicalPlan;
        case 'pipeline':
            return copy.pipelineGraph;
        case 'runtime':
            return copy.runtimeGraph;
        default:
            return copy.results;
    }
}

export function resultPanelAriaLabel(view: ResultsView, copy: Copy['common']): string {
    if (view === 'sqlmap') return copy.sqlStructure;
    return ['map', 'plan', 'pipeline', 'indexes', 'runtime'].includes(view)
        ? resultsViewTitle(view, copy)
        : copy.queryResults;
}

export function resultsTabLabel(view: ResultsView, copy: Copy['common']): string {
    switch (view) {
        case 'results':
            return copy.results;
        case 'chart':
            return copy.chart;
        case 'map':
            return copy.map;
        case 'sqlmap':
            return copy.sqlMap;
        case 'indexes':
            return copy.explain;
        case 'plan':
            return copy.logicalPlan;
        case 'pipeline':
            return copy.pipelineGraph;
        case 'runtime':
            return copy.runtimeGraph;
        default:
            return copy.insights;
    }
}

export function apiErrorDetail(error: unknown): ApiError {
    if (error instanceof RequestError) return error.detail;
    const candidate =
        error && typeof error === 'object'
            ? (error as { code?: unknown; message?: unknown })
            : undefined;
    return {
        code: typeof candidate?.code === 'string' ? candidate.code : 'EXECUTION_FAILED',
        message: typeof candidate?.message === 'string' ? candidate.message : message(error),
    };
}
