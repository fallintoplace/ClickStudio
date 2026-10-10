import type { SqlExample } from '../../sql-examples';
import { Button, Icon, cx } from '../ui';
import {
    categoryLabel,
    chartLabel,
    exampleText,
    type CategoryFilter,
} from '../workspace-help-model';
import type { WorkspaceHelpPanelProps } from './workspace-help-types';

export function SqlExamplesHelp({
    availableCategories,
    category,
    setCategory,
    searchRef,
    search,
    setSearch,
    cloudSchemaNotice,
    filteredExamples,
    optionRefs,
    selected,
    setSelectedId,
    selectedIsScript,
    copy,
    locale,
    schemaLoading,
    onRefreshSchema,
    onOpenExample,
    onClose,
    onRunExample,
}: {
    availableCategories: CategoryFilter[];
    category: CategoryFilter;
    setCategory: import('react').Dispatch<import('react').SetStateAction<CategoryFilter>>;
    searchRef: import('react').RefObject<HTMLInputElement | null>;
    search: string;
    setSearch: import('react').Dispatch<import('react').SetStateAction<string>>;
    cloudSchemaNotice: { message: string; error: boolean } | undefined;
    filteredExamples: SqlExample[];
    optionRefs: import('react').RefObject<Map<string, HTMLButtonElement>>;
    selected: SqlExample | undefined;
    setSelectedId: import('react').Dispatch<import('react').SetStateAction<string>>;
    selectedIsScript: boolean;
    copy: WorkspaceHelpPanelProps['copy'];
    locale: WorkspaceHelpPanelProps['locale'];
    schemaLoading: WorkspaceHelpPanelProps['schemaLoading'];
    onRefreshSchema: WorkspaceHelpPanelProps['onRefreshSchema'];
    onOpenExample: WorkspaceHelpPanelProps['onOpenExample'];
    onClose: WorkspaceHelpPanelProps['onClose'];
    onRunExample: WorkspaceHelpPanelProps['onRunExample'];
}) {
    return (
        <>
            <div className="sql-examples-toolbar">
                <div
                    className="sql-example-categories"
                    role="group"
                    aria-label={copy.exampleCategories}
                >
                    {availableCategories.map(value => (
                        <button
                            key={value}
                            data-testid={'sql-example-category-' + value}
                            type="button"
                            className={cx(
                                'sql-example-category',
                                category === value && 'is-active',
                            )}
                            aria-pressed={category === value}
                            onClick={() => setCategory(value)}
                        >
                            {categoryLabel(value, copy, locale)}
                        </button>
                    ))}
                </div>
                <label className="sql-example-search">
                    <Icon name="search" />
                    <input
                        ref={searchRef}
                        data-testid="sql-example-search"
                        type="search"
                        aria-label={copy.searchExamples}
                        placeholder={copy.searchExamples}
                        value={search}
                        onChange={event => {
                            const value = event.target.value;
                            setSearch(value);
                            if (value.trim() && category === 'featured') setCategory('all');
                        }}
                    />
                </label>
            </div>
            {cloudSchemaNotice && (
                <div
                    className={cx(
                        'sql-examples-schema-notice',
                        cloudSchemaNotice.error && 'is-error',
                    )}
                    role={cloudSchemaNotice.error ? 'alert' : 'status'}
                >
                    <p>{cloudSchemaNotice.message}</p>
                    <Button
                        variant="ghost"
                        className="toolbar-small"
                        aria-label={copy.sqlExamplesRefreshSchema}
                        title={copy.sqlExamplesRefreshSchema}
                        disabled={schemaLoading}
                        onClick={onRefreshSchema}
                    >
                        {schemaLoading ? copy.loading : copy.refresh}
                    </Button>
                </div>
            )}
            {filteredExamples.length === 0 ? (
                <p className="sql-examples-empty" role="status">
                    {copy.noExamplesFound}
                </p>
            ) : (
                <div className="sql-examples-layout">
                    <div className="sql-examples-list" role="listbox" aria-label={copy.sqlExamples}>
                        {filteredExamples.map((example, index) => (
                            <button
                                key={example.id}
                                data-testid={'sql-example-' + example.id}
                                ref={element => {
                                    if (element) optionRefs.current.set(example.id, element);
                                    else optionRefs.current.delete(example.id);
                                }}
                                type="button"
                                role="option"
                                tabIndex={example.id === selected?.id ? 0 : -1}
                                aria-selected={example.id === selected?.id}
                                className={cx(
                                    'sql-example-option',
                                    example.id === selected?.id && 'is-selected',
                                )}
                                onFocus={() => setSelectedId(example.id)}
                                onClick={() => setSelectedId(example.id)}
                                onKeyDown={event => {
                                    let nextIndex: number | undefined;
                                    if (event.key === 'ArrowDown')
                                        nextIndex = (index + 1) % filteredExamples.length;
                                    else if (event.key === 'ArrowUp')
                                        nextIndex =
                                            (index - 1 + filteredExamples.length) %
                                            filteredExamples.length;
                                    else if (event.key === 'Home') nextIndex = 0;
                                    else if (event.key === 'End')
                                        nextIndex = filteredExamples.length - 1;
                                    if (nextIndex === undefined) return;
                                    event.preventDefault();
                                    const nextExample = filteredExamples[nextIndex]!;
                                    setSelectedId(nextExample.id);
                                    optionRefs.current.get(nextExample.id)?.focus();
                                }}
                            >
                                <span className="sql-example-option-title">
                                    {exampleText(example, locale, copy).name}
                                </span>
                                <span className="sql-example-option-description">
                                    {exampleText(example, locale, copy).description}
                                </span>
                                <span className="sql-example-option-meta">
                                    <span className="sql-example-option-category">
                                        {example.dataset ??
                                            categoryLabel(example.category, copy, locale)}
                                    </span>
                                    <span className="sql-example-chart-kind">
                                        {example.category === 'writeOperations'
                                            ? copy.exampleWriteOperations
                                            : chartLabel(example, copy)}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                    {selected && (
                        <article className="sql-example-preview">
                            <div className="sql-example-preview-heading">
                                <div>
                                    <span className="eyebrow">
                                        {selected.dataset ??
                                            categoryLabel(selected.category, copy, locale)}
                                    </span>
                                    <h3>
                                        {exampleText(selected, locale, copy).name}
                                        .sql
                                    </h3>
                                </div>
                                <span className="sql-example-readonly">
                                    {selected.category === 'writeOperations'
                                        ? copy.exampleWriteOperations
                                        : chartLabel(selected, copy)}
                                </span>
                            </div>
                            <p>{exampleText(selected, locale, copy).description}</p>
                            <pre>
                                <code>{selected.sql}</code>
                            </pre>
                            <div className="sql-example-actions">
                                <Button
                                    variant="secondary"
                                    className="sql-example-action"
                                    data-testid="open-sql-example"
                                    aria-label={copy.openInNewSql}
                                    title={copy.openInNewSql}
                                    onClick={() => {
                                        if (onOpenExample(selected)) onClose(false);
                                    }}
                                >
                                    <Icon name="plus" />
                                    {copy.openExample}
                                </Button>
                                <Button
                                    variant="primary"
                                    className="sql-example-action"
                                    data-testid="run-sql-example"
                                    onClick={() => {
                                        if (onRunExample(selected, 'results')) onClose(false);
                                    }}
                                >
                                    <Icon name="play" />
                                    {selectedIsScript ? copy.runScript : copy.run}
                                </Button>
                                {!selectedIsScript && selected.category !== 'writeOperations' && (
                                    <Button
                                        variant="secondary"
                                        className="sql-example-action"
                                        data-testid="chart-sql-example"
                                        onClick={() => {
                                            if (onRunExample(selected, 'chart')) onClose(false);
                                        }}
                                    >
                                        <Icon name="chart" />
                                        {copy.chart}
                                    </Button>
                                )}
                            </div>
                        </article>
                    )}
                </div>
            )}
        </>
    );
}
