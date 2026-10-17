import { useEffect, useMemo, useRef, useState } from 'react';
import type { Result, ResultPage } from '../../../shared/queries/results/types';
import type { Run } from '../../../shared/queries/execution/types';
import { columnStats } from '../../../shared/queries/results/column-insights';
import { api, apiResponses, message } from '../../api/client';
import { useDialogFocus } from '../../ui/focus/useDialogFocus';

export function ColumnInsights({
    run, page, columnIndex, onClose,
}: {
    run: Run;
    page: ResultPage;
    columnIndex: number;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const [snapshot, setSnapshot] = useState<Result>();
    const [error, setError] = useState('');
    const column = page.columns[columnIndex]!;
    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        return () => element.close();
    }, []);
    useDialogFocus(dialog, { onClose, initialFocus: () => closeButton.current });
    useEffect(() => {
        let current = true;
        const controller = new AbortController();
        void api('/runs/' + encodeURIComponent(run.id) + '/snapshot', apiResponses.isResultResponse, {
            signal: controller.signal,
        }).then(result => {
            if (current) setSnapshot(result);
        }).catch(caught => {
            if (current) setError(message(caught));
        });
        return () => { current = false; controller.abort(); };
    }, [run.id]);

    const source = snapshot ?? page;
    const stats = useMemo(
        () => columnStats(source.rows, column, columnIndex, source.largeCellToken),
        [source, column, columnIndex],
    );
    const scope = snapshot ? 'retained result' : 'current page';
    const fmt = (value: number | undefined) =>
        value === undefined ? 'Unavailable' : value.toLocaleString('en-US', { maximumFractionDigits: 4 });
    const maxBar = Math.max(1, ...stats.histogram);
    return (
        <dialog
            ref={dialog}
            className="transfer-dialog result-column-insights"
            aria-labelledby="result-column-insights-title"
            onCancel={event => { event.preventDefault(); onClose(); }}
            onClick={event => { if (event.target === dialog.current) onClose(); }}
        >
            <header className="transfer-dialog-header">
                <div>
                    <h2 className="transfer-dialog-title" id="result-column-insights-title">
                        {column.name} · Column insights
                    </h2>
                    <p className="transfer-dialog-description">
                        {column.type} · {scope} only
                    </p>
                </div>
                <button className="button-base button-ghost" type="button" ref={closeButton}
                    onClick={onClose} aria-label="Close column insights">Close</button>
            </header>
            {!snapshot && !error && <p role="status">Loading retained rows…</p>}
            {error && <p role="status">Could not load all retained rows. Showing this page only: {error}</p>}
            <p className="result-insights-notice">
                {source.completeness === 'truncated'
                    ? 'This result is truncated. These statistics do not describe the full query output.'
                    : 'These statistics describe the ' + scope + ', not necessarily the source table.'}
            </p>
            <div className="result-insights-summary">
                <span>Rows <strong>{fmt(stats.total)}</strong></span>
                <span>Null <strong>{fmt(stats.nulls)}</strong></span>
                <span>Distinct <strong>{stats.distinctCapped ? '≥ ' : ''}{fmt(stats.distinct)}</strong></span>
                <span>Large cells <strong>{fmt(stats.detached)}</strong></span>
            </div>
            {stats.numericCount > 0 && (
                <section aria-label="Numeric statistics">
                    <div className="result-insights-summary">
                        <span>Min <strong>{fmt(stats.minimum)}</strong></span>
                        <span>Max <strong>{fmt(stats.maximum)}</strong></span>
                        <span>Average <strong>{fmt(stats.average)}</strong></span>
                        <span>Numeric values <strong>{fmt(stats.numericCount)}</strong></span>
                    </div>
                    <div className="result-insights-histogram" role="img" aria-label="Numeric values across ten buckets">
                        {stats.histogram.map((count, index) => (
                            <span key={index} title={String(count) + ' values'}
                                style={{ height: String(Math.max(2, count / maxBar * 100)) + '%' }} />
                        ))}
                    </div>
                </section>
            )}
            {stats.nonRepresentable > 0 && (
                <p className="result-insights-notice">
                    {fmt(stats.nonRepresentable)} numeric values were excluded from arithmetic to avoid precision loss.
                </p>
            )}
            {stats.common.length > 0 && (
                <section aria-label="Most common values">
                    <strong>Most common values</strong>
                    <ol className="result-insights-common">
                        {stats.common.map((entry, index) => (
                            <li key={index}><span title={entry.label}>{entry.label}</span><strong>{fmt(entry.count)}</strong></li>
                        ))}
                    </ol>
                    {stats.distinctCapped && <small>Distinct values are capped for memory safety.</small>}
                </section>
            )}
        </dialog>
    );
}