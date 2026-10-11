import type { NativeParseSnapshot, NativeParserStatus } from '../../../../shared/sql/parser';
import { nativeHighlightRanges } from '../../../../shared/sql/parser';
import { Button, cx, Spinner } from '../../../common/components/ui';
import { Icon } from '../../../common/components/icons';

type Props = {
    enabled: boolean;
    status: NativeParserStatus;
    snapshot?: NativeParseSnapshot;
    onRetry: () => void;
};

const MAX_AST_PREVIEW_LENGTH = 100_000;

export function NativeParserInspector({ enabled, status, snapshot, onRetry }: Props) {
    const getParserTone = () => {
        if (!enabled) {
            return '';
        }

        switch (status) {
            case 'ready':
                return 'is-trusted';

            case 'unavailable':
                return 'is-warning';

            default:
                return 'is-running';
        }
    };
    const getParserStatusLabel = () => {
        if (enabled) {
            switch (status) {
                case 'ready':
                    return 'Ready · local WebAssembly';

                case 'loading':
                    return 'Loading parser…';

                default:
                    return 'Unavailable';
            }
        }

        return 'WASM parser off';
    };
    return (
        <section
            className="inspector-section parser-inspector"
            aria-label="ClickHouse parser details"
        >
            <div
                className={cx(
                    'parser-status-card',
                    `parser-status-${enabled ? status : 'disabled'}`,
                )}
            >
                <span className={cx('status-light', getParserTone())} />
                <div>
                    <strong>
                        {enabled ? 'ClickHouse native parser' : 'CodeMirror SQL highlighting'}
                    </strong>
                    <small>{getParserStatusLabel()}</small>
                </div>
                {enabled && snapshot && (
                    <span className="parser-duration">{snapshot.elapsedMs.toFixed(1)} ms</span>
                )}
                {enabled && status === 'unavailable' && (
                    <Button variant="ghost" className="toolbar-small" onClick={onRetry}>
                        Retry
                    </Button>
                )}
            </div>

            {!enabled && (
                <div className="inspector-empty">
                    <Icon name="parser" />
                    <strong>CodeMirror mode active</strong>
                    <p>
                        CodeMirror provides SQL highlighting. ClickHouse-specific diagnostics and
                        AST details are off; Format uses the fallback formatter.
                    </p>
                </div>
            )}
            {enabled && status === 'loading' && (
                <div className="inspector-empty">
                    <Spinner />
                    <strong>Loading parser</strong>
                    <p>SQL stays available while the native parser starts.</p>
                </div>
            )}
            {enabled && status === 'unavailable' && (
                <div className="inspector-empty">
                    <Icon name="parser" />
                    <strong>Parser unavailable</strong>
                    <p>
                        The SQL editor stays available when parser loading fails. Retry here to
                        check the parser artifact again.
                    </p>
                </div>
            )}
            {enabled && status === 'ready' && !snapshot && (
                <div className="inspector-empty">
                    <Icon name="parser" />
                    <strong>Waiting for SQL</strong>
                    <p>Native parse results appear here after the current SQL is checked.</p>
                </div>
            )}
            {enabled &&
                status === 'ready' &&
                snapshot?.statements.map((statement, index) => {
                    const { result } = statement;
                    const astType =
                        typeof result.ast === 'object' &&
                        result.ast !== null &&
                        !Array.isArray(result.ast) &&
                        typeof (result.ast as { type?: unknown }).type === 'string'
                            ? (result.ast as { type: string }).type
                            : undefined;
                    const functions = [
                        ...new Set(
                            nativeHighlightRanges(statement.sql, 0, result.highlights)
                                .filter(range => range.type === 'function')
                                .map(range => statement.sql.slice(range.from, range.to)),
                        ),
                    ];
                    const astJson =
                        result.ast === undefined || result.ast === null
                            ? undefined
                            : JSON.stringify(result.ast, null, 2);
                    const astPreview =
                        astJson && astJson.length > MAX_AST_PREVIEW_LENGTH
                            ? `${astJson.slice(0, MAX_AST_PREVIEW_LENGTH)}\n… AST preview truncated …`
                            : astJson;
                    return (
                        <article
                            className="parser-statement-card"
                            key={`${statement.from}-${index}`}
                        >
                            <header className="parser-statement-heading">
                                <span>STATEMENT {index + 1}</span>
                                <span
                                    className={cx(
                                        'parser-validity',
                                        result.error ? 'is-invalid' : 'is-valid',
                                    )}
                                >
                                    <span className="status-light" />
                                    {result.error ? 'Invalid SQL' : 'Valid ClickHouse SQL'}
                                </span>
                            </header>
                            {result.error ? (
                                <div className="parser-error" role="alert">
                                    <strong>{result.error.message}</strong>
                                    {result.error.expected?.length ? (
                                        <div className="parser-expected">
                                            <span>EXPECTED</span>
                                            <div>
                                                {result.error.expected.slice(0, 12).map(token => (
                                                    <code key={token}>{token}</code>
                                                ))}
                                                {result.error.expected.length > 12 && (
                                                    <small>
                                                        +{result.error.expected.length - 12} more
                                                    </small>
                                                )}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            ) : (
                                <dl className="parser-facts">
                                    <div>
                                        <dt>Statement</dt>
                                        <dd>{astType ?? 'Parsed successfully'}</dd>
                                    </div>
                                    <div>
                                        <dt>Native tokens</dt>
                                        <dd>{result.highlights?.length ?? 0}</dd>
                                    </div>
                                    <div>
                                        <dt>AST JSON</dt>
                                        <dd>
                                            {astJson
                                                ? 'Available'
                                                : (result.ast_error ??
                                                  'Not available in this build')}
                                        </dd>
                                    </div>
                                </dl>
                            )}
                            {functions.length > 0 && (
                                <div className="parser-functions">
                                    <span>FUNCTIONS</span>
                                    <div>
                                        {functions.slice(0, 20).map(name => (
                                            <code key={name}>{name}</code>
                                        ))}
                                        {functions.length > 20 && (
                                            <small>+{functions.length - 20} more</small>
                                        )}
                                    </div>
                                </div>
                            )}
                            {astPreview && (
                                <details className="parser-ast">
                                    <summary>
                                        <span>View native AST</span>
                                        <code>JSON</code>
                                    </summary>
                                    <pre>{astPreview}</pre>
                                    {astJson && astJson.length > MAX_AST_PREVIEW_LENGTH && (
                                        <small>
                                            AST preview is limited to{' '}
                                            {MAX_AST_PREVIEW_LENGTH.toLocaleString()} characters.
                                        </small>
                                    )}
                                </details>
                            )}
                        </article>
                    );
                })}
        </section>
    );
}
