import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ClickHouseDocumentationEntry, ClickHouseDocumentationSummary, ReferenceCategory } from '../../shared/types';
import { REFERENCE_CATEGORIES, referenceId } from '../../shared/reference';
import { message } from '../api';
import { createReferenceProvider, isReferenceUnavailable, bundledProvider } from '../reference-provider';
import type { Connected } from '../workspace-types';
import type { Copy } from '../i18n';
import { Button, cx, Icon } from './ui';

type ReferenceTarget = { name: string; type: string };
const REFERENCE_PAGE_SIZE = 100;

type ReferenceExplorerProps = {
    copy: Copy['common'];
    connection: Connected;
    trusted: boolean;
    target?: ReferenceTarget;
    onTargetHandled: () => void;
    onInsert: (value: string) => void;
};

const categoryCopy: Record<ReferenceCategory, keyof Copy['common']> = {
    all: 'referenceAll', functions: 'referenceFunctions', types: 'referenceTypes',
    engines: 'referenceEngines', settings: 'referenceSettings', system: 'referenceSystem',
    formats: 'referenceFormats', sql: 'referenceSql',
};

export function ReferenceExplorer({ copy, connection, trusted, target, onTargetHandled, onInsert }: ReferenceExplorerProps) {
    const nativeProvider = useMemo(() => createReferenceProvider(connection), [connection]);
    const [forceBundled, setForceBundled] = useState(false);
    const provider = nativeProvider.kind === 'bundled' || forceBundled ? bundledProvider : nativeProvider;
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState<ReferenceCategory>('all');
    const [results, setResults] = useState<ClickHouseDocumentationSummary[]>([]);
    const [resultsAreBundled, setResultsAreBundled] = useState(nativeProvider.kind === 'bundled');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selected, setSelected] = useState<ClickHouseDocumentationEntry>();
    const [activeEntry, setActiveEntry] = useState<ClickHouseDocumentationSummary>();
    const [entryLoading, setEntryLoading] = useState(false);
    const [entryError, setEntryError] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [visibleResultCount, setVisibleResultCount] = useState(REFERENCE_PAGE_SIZE);
    const [retryToken, setRetryToken] = useState(0);
    const resultListRef = useRef<HTMLDivElement | null>(null);
    const lastVisibleResultRef = useRef<HTMLButtonElement | null>(null);
    const searchRequest = useRef<AbortController | undefined>(undefined);
    const entryRequest = useRef<AbortController | undefined>(undefined);
    const lastTarget = useRef('');
    const canLoadMore = (nativeProvider.kind !== 'native' || trusted)
        && !loading && !selected && !entryLoading && !entryError
        && results.length > visibleResultCount;

    useEffect(() => {
        setForceBundled(false);
        setQuery('');
        setCategory('all');
        setResults([]);
        setResultsAreBundled(nativeProvider.kind === 'bundled');
        setSelected(undefined);
        setActiveEntry(undefined);
        setEntryLoading(false);
        setError('');
        setEntryError('');
    }, [connection.id, nativeProvider.kind]);

    useEffect(() => {
        searchRequest.current?.abort();
        const controller = new AbortController();
        searchRequest.current = controller;
        if (provider.kind === 'native' && !trusted) {
            setResults([]);
            setLoading(false);
            return () => controller.abort();
        }
        setLoading(true);
        setError('');
        const timer = window.setTimeout(() => {
            void provider.search(query, category, controller.signal).then(async entries => {
                if (controller.signal.aborted) return;
                if (provider.kind === 'native' && entries.length === 0) {
                    try {
                        const offlineEntries = await bundledProvider.search(query, category, controller.signal);
                        if (controller.signal.aborted) return;
                        if (offlineEntries.length > 0) {
                            setResults(offlineEntries);
                            setResultsAreBundled(true);
                            return;
                        }
                    } catch (fallbackError) {
                        if (!controller.signal.aborted) setError(message(fallbackError));
                        return;
                    }
                }
                setResults(entries);
                setResultsAreBundled(provider.kind === 'bundled');
            }).catch(async caught => {
                if (controller.signal.aborted) return;
                if (provider.kind === 'native' && isReferenceUnavailable(caught)) {
                    try {
                        const entries = await bundledProvider.search(query, category, controller.signal);
                        if (controller.signal.aborted) return;
                        setForceBundled(true);
                        setResults(entries);
                        setResultsAreBundled(true);
                    } catch (fallbackError) {
                        if (!controller.signal.aborted) setError(message(fallbackError));
                    }
                } else {
                    setError(message(caught));
                }
            }).finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        }, query ? 180 : 0);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [provider, query, category, trusted, retryToken]);

    useEffect(() => {
        setActiveIndex(0);
        setVisibleResultCount(REFERENCE_PAGE_SIZE);
    }, [results]);

    useEffect(() => {
        const list = resultListRef.current;
        const lastVisibleResult = lastVisibleResultRef.current;
        if (!list || !lastVisibleResult || !canLoadMore) return;

        const observer = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;
            setVisibleResultCount(count => count === visibleResultCount
                ? Math.min(results.length, count + REFERENCE_PAGE_SIZE)
                : count);
        }, { root: list, rootMargin: '0px 0px 80px 0px' });
        observer.observe(lastVisibleResult);
        return () => observer.disconnect();
    }, [canLoadMore, results.length, visibleResultCount]);

    useEffect(() => {
        resultListRef.current?.querySelector<HTMLElement>(`[data-reference-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, visibleResultCount]);

    const openEntry = useCallback(async (summary: ClickHouseDocumentationSummary) => {
        entryRequest.current?.abort();
        const controller = new AbortController();
        entryRequest.current = controller;
        setActiveEntry(summary);
        setSelected(undefined);
        setEntryError('');
        if (provider.kind === 'native' && !trusted) {
            setEntryLoading(false);
            setEntryError(copy.trustToInspect);
            return;
        }
        setEntryLoading(true);
        try {
            let entry = await provider.get(summary.name, summary.type, controller.signal);
            if (!entry && provider.kind === 'native' && nativeProvider.kind === 'native') {
                entry = await bundledProvider.get(summary.name, summary.type, controller.signal);
            }
            if (controller.signal.aborted) return;
            if (!entry) setEntryError(copy.referenceEntryUnavailable);
            else setSelected(entry);
        } catch (caught) {
            if (controller.signal.aborted) return;
            if (provider.kind === 'native' && isReferenceUnavailable(caught)) {
                try {
                    const entry = await bundledProvider.get(summary.name, summary.type, controller.signal);
                    if (controller.signal.aborted) return;
                    if (entry) {
                        setForceBundled(true);
                        setSelected(entry);
                    } else setEntryError(copy.referenceEntryUnavailable);
                } catch (fallbackError) {
                    if (!controller.signal.aborted) setEntryError(message(fallbackError));
                }
            } else setEntryError(message(caught));
        } finally {
            if (!controller.signal.aborted) setEntryLoading(false);
        }
    }, [copy.referenceEntryUnavailable, copy.trustToInspect, nativeProvider.kind, provider, trusted]);

    useEffect(() => () => {
        searchRequest.current?.abort();
        entryRequest.current?.abort();
    }, []);

    useEffect(() => {
        if (!target) return;
        const key = `${connection.id}\u0000${target.type}\u0000${target.name}`;
        if (key === lastTarget.current) return;
        lastTarget.current = key;
        void openEntry(target);
        onTargetHandled();
    }, [connection.id, target, openEntry, onTargetHandled]);

    const chooseActive = () => {
        const summary = results[activeIndex];
        if (summary) void openEntry(summary);
    };

    const navigateResults = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (selected || entryLoading || entryError) {
                entryRequest.current?.abort();
                setSelected(undefined);
                setActiveEntry(undefined);
                setEntryError('');
                setEntryLoading(false);
            } else if (query) setQuery('');
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!results.length) return;
            event.preventDefault();
            const nextIndex = event.key === 'ArrowDown' ? (activeIndex + 1) % results.length : (activeIndex - 1 + results.length) % results.length;
            if (nextIndex >= visibleResultCount) setVisibleResultCount(Math.min(results.length, Math.ceil((nextIndex + 1) / REFERENCE_PAGE_SIZE) * REFERENCE_PAGE_SIZE));
            setActiveIndex(nextIndex);
        } else if (event.key === 'Enter' && !selected) {
            event.preventDefault();
            chooseActive();
        }
    };

    const isBundled = provider.kind === 'bundled' || resultsAreBundled;
    const resultTitle = query ? copy.referenceMatches.replace('{count}', results.length.toLocaleString()) : copy.referenceBrowse;
    const visibleResults = results.slice(0, visibleResultCount);

    return <section className="inspector-section object-explorer-section reference-explorer" onKeyDown={navigateResults}>
        {nativeProvider.kind === 'native' && !trusted ? <div className="inspector-empty"><Icon name="lock"/><strong>{copy.schemaPrivate}</strong><p>{copy.trustToInspect}</p></div> : <>
            {selected || entryLoading || entryError ? <div className="reference-detail-view">
                <button type="button" className="reference-back" onClick={() => { entryRequest.current?.abort(); setSelected(undefined); setActiveEntry(undefined); setEntryLoading(false); setEntryError(''); }}><span>‹</span>{copy.referenceBack}</button>
                {entryLoading && <div className="inspector-empty"><span className="loading-orbit"/><p>{copy.loading}</p></div>}
                {entryError && <div className="object-empty-search" role="alert"><strong>{entryError}</strong><Button variant="secondary" className="toolbar-small" onClick={() => activeEntry && void openEntry(activeEntry)}>{copy.referenceRetry}</Button></div>}
                {selected && <article className="reference-entry" aria-label={`${selected.type}: ${selected.name}`}>
                    <div className="reference-entry-heading"><span>{selected.type}</span><h3>{selected.type === 'System Table' ? `system.${selected.name}` : selected.name}</h3><small>{selected.origin === 'bundled' ? copy.referenceBundled : `ClickHouse ${selected.serverVersion}`}</small></div>
                    <div className="reference-entry-actions"><Button variant="secondary" className="toolbar-small" onClick={() => onInsert(referenceInsertValue(selected))}>{copy.referenceInsert}</Button><Button variant="ghost" className="toolbar-small" onClick={() => void navigator.clipboard.writeText(referenceInsertValue(selected)).catch(() => undefined)}>{copy.referenceCopy}</Button></div>
                    <div className="reference-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children, ...props }) => <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a> }}>{selected.description}</ReactMarkdown></div>
                    {(selected.source || selected.origin === 'native') && <div className="reference-entry-source"><span>{copy.referenceSource}</span>{selected.source?.startsWith('https://') ? <a href={selected.source} target="_blank" rel="noreferrer">{selected.source}</a> : <code>{selected.source ?? copy.referenceNative}</code>}</div>}
                </article>}
            </div> : <>
                <label className="inspector-search reference-search"><Icon name="search"/><input data-testid="reference-search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder={copy.referenceSearch} aria-label={copy.referenceSearch}/>{query && <button type="button" className="object-search-clear" aria-label={copy.clearSearch} onClick={() => setQuery('')}>×</button>}</label>
                <div className="reference-categories" role="group" aria-label={copy.referenceCategories}>{REFERENCE_CATEGORIES.map(value => <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}>{copy[categoryCopy[value]]}</button>)}</div>
                <div className="reference-list-heading"><span>{resultTitle}</span>{!loading && <small>{results.length.toLocaleString()}</small>}</div>
                {error && <div className="callout callout-error" role="alert">{error}<Button variant="ghost" className="toolbar-small" onClick={() => setRetryToken(value => value + 1)}>{copy.referenceRetry}</Button></div>}
                {loading && <div className="inspector-empty"><span className="loading-orbit"/><p>{copy.loading}</p></div>}
                {!loading && !error && !results.length && <div className="object-empty-search"><strong>{copy.referenceNoMatches}</strong><span>{copy.referenceEmptyHint}</span></div>}
                {!loading && results.length > 0 && <div ref={resultListRef} className="reference-results" role="listbox" aria-label={copy.referenceResults} aria-activedescendant={visibleResults[activeIndex] ? `reference-option-${activeIndex}` : undefined}>
                    {visibleResults.map((entry, index) => <button ref={canLoadMore && index === visibleResults.length - 1 ? lastVisibleResultRef : undefined} id={`reference-option-${index}`} data-reference-index={index} key={referenceId(entry)} type="button" role="option" aria-selected={index === activeIndex} className={cx('reference-result', referenceResultTone(entry.type), index === activeIndex && 'is-active')} onMouseEnter={() => setActiveIndex(index)} onClick={() => { setActiveIndex(index); void openEntry(entry); }}>
                        <span className="reference-result-glyph"><Icon name={entry.type === 'System Table' ? 'table' : entry.type.includes('Engine') ? 'database' : entry.type.includes('Type') ? 'column' : 'documents'}/></span>
                        <span className="reference-result-copy"><strong>{entry.type === 'System Table' ? `system.${entry.name}` : entry.name}</strong><small>{entry.type}</small></span><span className="history-open">›</span>
                    </button>)}
                </div>}
            </>}
            <div className="reference-source-footer" data-testid="reference-source">
                <span className={cx('reference-source-light', isBundled ? 'is-bundled' : 'is-native')}/>
                <span className="reference-source-title">{isBundled ? copy.referenceBundled : copy.referenceNative}</span>
                {isBundled && <small>{copy.referenceBundledNote}</small>}
            </div>
        </>}
    </section>;
}

function referenceInsertValue(entry: ClickHouseDocumentationSummary) {
    if (entry.type === 'System Table') return `system.${entry.name}`;
    return entry.name;
}

function referenceResultTone(type: string) {
    if (type.includes('Aggregate')) return 'is-aggregate';
    if (type === 'Data Type') return 'is-type';
    if (['Table Engine', 'Database Engine', 'Dictionary Layout', 'Dictionary Source', 'Data Skipping Index', 'Disk Type', 'Compression Codec'].includes(type)) return 'is-engine';
    if (type.includes('Setting')) return 'is-setting';
    if (['System Table', 'Profile Event', 'Current Metric', 'Asynchronous Metric'].includes(type)) return 'is-system';
    if (type === 'Format') return 'is-format';
    if (['Statement', 'SQL Statement', 'SQL Operator', 'SQL Syntax', 'Protocol'].includes(type)) return 'is-sql';
    return 'is-function';
}
