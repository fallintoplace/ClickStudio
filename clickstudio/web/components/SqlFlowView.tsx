import { useMemo, useState } from 'react';
import type { NativeParseResult, NativeParserStatus } from '../../shared/native-parser';
import { buildSqlFlow } from '../sql-flow';
import { AnalyzerTreeView } from './AnalyzerTreeView';
import { AstGraph } from './AstGraph';
import { PipelineGraph } from './PipelineGraph';
import { ScrollEdgeFrame } from './ScrollEdgeShadows';
import type { Copy } from '../i18n';

type StructureView = 'flow' | 'ast' | 'analyzer';

export type SqlFlowViewProps = {
    copy: Copy['common'];
    sql: string;
    sourceOffset: number;
    connectionId: string;
    parameters: Record<string, string>;
    analyzerAvailable: boolean;
    analyzerUnavailableReason?: string;
    parseResult?: NativeParseResult;
    parserEnabled: boolean;
    parserStatus: NativeParserStatus;
    parseDurationMs?: number;
    onRevealRange: (from: number, to: number) => void;
};

export function SqlFlowView({
    copy,
    sql,
    sourceOffset,
    parseResult,
    parserEnabled,
    parserStatus,
    parseDurationMs,
    connectionId,
    parameters,
    analyzerAvailable,
    analyzerUnavailableReason,
    onRevealRange,
}: SqlFlowViewProps) {
    const [view, setView] = useState<StructureView>('flow');
    const model = useMemo(
        () => buildSqlFlow(sql, parseResult, sourceOffset),
        [sql, parseResult, sourceOffset],
    );
    const duration = parseDurationMs === undefined ? undefined : `${parseDurationMs.toFixed(1)} ms`;
    let parserLabel: string;

    if (view === 'analyzer') {
        parserLabel = copy.queryTreeServer;
    } else if (!parserEnabled) {
        parserLabel = copy.sqlFlowCodeMirror;
    } else if (parserStatus === 'loading') {
        parserLabel = copy.sqlFlowParserStarting;
    } else if (parserStatus === 'unavailable') {
        parserLabel = copy.sqlFlowParserUnavailable;
    } else if (model.mode === 'native AST') {
        parserLabel = copy.sqlFlowNativeAst;
    } else {
        parserLabel = copy.sqlFlowKeywordEstimate;
    }
    const astAvailable = Boolean(
        parserEnabled && parserStatus === 'ready' && !parseResult?.error && parseResult?.ast,
    );
    let astUnavailableReason: string;

    if (!parserEnabled) {
        astUnavailableReason = copy.sqlFlowCodeMirror;
    } else {
        switch (parserStatus) {
            case 'loading':
                astUnavailableReason = copy.sqlFlowParserStarting;
                break;
            case 'unavailable':
                astUnavailableReason = copy.sqlFlowParserUnavailable;
                break;
            default:
                astUnavailableReason =
                    parseResult?.error?.message ?? parseResult?.ast_error ?? copy.sqlAstUnavailable;
                break;
        }
    }

    return (
        <ScrollEdgeFrame<HTMLElement> className="sql-flow-view-frame">
            {ref => {
                const getSelectionHint = () => {
                    switch (view) {
                        case 'ast':
                            return copy.sqlAstClickNode;

                        case 'analyzer':
                            return copy.queryTreeClickNode;

                        default:
                            return copy.sqlFlowClickStage;
                    }
                };
                return (
                    <section
                        ref={ref}
                        className="sql-flow-view"
                        aria-label={copy.visualizeSqlStructure}
                    >
                        <header className="sql-flow-heading">
                            <div>
                                <span className="eyebrow">{copy.sqlStructure.toUpperCase()}</span>
                                <h3>{copy.sqlFlowTitle}</h3>
                                <p>{getSelectionHint()}</p>
                            </div>
                            <span
                                className={`sql-flow-parser-state ${view === 'analyzer' || model.mode === 'native AST' ? 'is-native' : ''}`}
                            >
                                <span className="status-light" />
                                {parserLabel}
                                {duration && view !== 'analyzer' && model.mode === 'native AST'
                                    ? ` · ${duration}`
                                    : ''}
                            </span>
                        </header>
                        <div
                            className="sql-flow-mode-tabs"
                            role="group"
                            aria-label={copy.sqlStructure}
                        >
                            <button
                                type="button"
                                aria-pressed={view === 'flow'}
                                className={view === 'flow' ? 'is-active' : ''}
                                onClick={() => setView('flow')}
                            >
                                {copy.sqlFlowLogicalMode}
                            </button>
                            <button
                                type="button"
                                aria-pressed={view === 'ast'}
                                className={view === 'ast' ? 'is-active' : ''}
                                disabled={!astAvailable && view !== 'ast'}
                                title={!astAvailable ? astUnavailableReason : copy.sqlFlowNativeAst}
                                onClick={() => setView('ast')}
                            >
                                {copy.sqlFlowNativeAst}
                            </button>
                            <button
                                type="button"
                                aria-pressed={view === 'analyzer'}
                                className={view === 'analyzer' ? 'is-active' : ''}
                                disabled={!analyzerAvailable}
                                title={
                                    !analyzerAvailable
                                        ? analyzerUnavailableReason
                                        : copy.queryTreeGraphHint
                                }
                                onClick={() => setView('analyzer')}
                            >
                                {copy.sqlFlowAnalyzer}
                            </button>
                        </div>
                        {view === 'flow' && model.parserError && (
                            <div className="sql-flow-parse-note" role="status">
                                {model.mode === 'native AST'
                                    ? copy.sqlFlowAstDetail
                                    : copy.sqlFlowSqlDetail}
                                {model.parserError}
                            </div>
                        )}
                        {!sql.trim() ? (
                            <div className="pipeline-graph-empty">{copy.sqlFlowEmpty}</div>
                        ) : (
                            <>
                                {view === 'ast' &&
                                    (astAvailable ? (
                                        <AstGraph ast={parseResult!.ast} copy={copy} />
                                    ) : (
                                        <div className="pipeline-graph-empty" role="status">
                                            {astUnavailableReason}
                                        </div>
                                    ))}
                                {view === 'flow' && (
                                    <PipelineGraph
                                        copy={copy}
                                        pipeline={model.pipeline}
                                        graphKind="sql-flow"
                                        heading={
                                            model.mode === 'native AST'
                                                ? copy.sqlFlowNativeHeading
                                                : copy.sqlFlowFallbackHeading
                                        }
                                        subheading={copy.sqlFlowGraphHint}
                                        onSelectNode={node => {
                                            const range = model.sourceRanges.get(node.id);
                                            if (range) onRevealRange(range.from, range.to);
                                        }}
                                    />
                                )}
                                <AnalyzerTreeView
                                    active={view === 'analyzer'}
                                    available={analyzerAvailable}
                                    unavailableReason={analyzerUnavailableReason}
                                    connectionId={connectionId}
                                    sql={sql}
                                    parameters={parameters}
                                    copy={copy}
                                />
                            </>
                        )}
                    </section>
                );
            }}
        </ScrollEdgeFrame>
    );
}
