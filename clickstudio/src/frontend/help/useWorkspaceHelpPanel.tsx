import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
} from 'react';
import { PLAYGROUND_CONNECTION_ID } from '../common/requests/sources/playground';
import { safeStatementCount } from '../workspace/workspace-helpers';
import { Icon } from '../common/components/icons';
import { cx } from '../common/components/ui';
import {
    exampleText,
    helpCategories,
    helpSections,
    type CategoryFilter,
    type HelpPanelSection,
} from './workspace-help-model';
import type { WorkspaceHelpPanelProps } from './workspace-help-types';
import { createHelpExplainActions } from './examples/help-explain-actions';

export function useWorkspaceHelpPanel(props: WorkspaceHelpPanelProps) {
    const {
        examples,
        copy,
        locale,
        open,
        section,
        onSectionChange,
        onClose,
        connection,
        tables,
        schemaLoaded,
        schemaLoading,
        schemaError,
        trusted,
        busy,
        unsupportedParameters,
        onRunExplain,
    } = props;
    const panelRef = useRef<HTMLElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const tabRefs = useRef(new Map<HelpPanelSection, HTMLButtonElement>());
    const sectionRef = useRef(section);
    sectionRef.current = section;
    const optionRefs = useRef(new Map<string, HTMLButtonElement>());
    const sections = helpSections(copy);
    const { explainActions } = createHelpExplainActions({
        copy,
        connection,
        trusted,
        busy,
        unsupportedParameters,
        onRunExplain,
    });

    const featuredExamples = useMemo(
        () =>
            examples
                .filter(example => example.featuredOrder !== undefined)
                .sort((left, right) => left.featuredOrder! - right.featuredOrder!),
        [examples],
    );
    const defaultExample = featuredExamples[0] ?? examples[0];
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<CategoryFilter>(
        featuredExamples.length ? 'featured' : 'all',
    );
    const [selectedId, setSelectedId] = useState(defaultExample?.id ?? '');

    const filteredExamples = useMemo(() => {
        const term = search.trim().toLocaleLowerCase();
        const candidates = category === 'featured' ? featuredExamples : examples;
        return candidates.filter(example => {
            if (category === 'charts' && example.chart.kind === 'table') return false;
            if (
                category !== 'all' &&
                category !== 'charts' &&
                category !== 'featured' &&
                example.category !== category
            )
                return false;
            if (!term) return true;
            const localized = exampleText(example, locale, copy);
            return [
                example.name,
                localized.name,
                example.dataset ?? '',
                example.description,
                localized.description,
                example.sql,
            ]
                .join(' ')
                .toLocaleLowerCase()
                .includes(term);
        });
    }, [category, copy, examples, featuredExamples, locale, search]);
    const selected =
        filteredExamples.find(example => example.id === selectedId) ?? filteredExamples[0];
    const selectedIsScript = selected ? (safeStatementCount(selected.sql) ?? 0) > 1 : false;
    const availableCategories = helpCategories.filter(value => {
        if (value === 'all') return true;
        if (value === 'featured') return featuredExamples.length > 0;
        if (value === 'charts') return examples.some(example => example.chart.kind !== 'table');
        return examples.some(example => example.category === value);
    });
    const visibleTables = tables.some(
        table => !['system', 'information_schema'].includes(table.database.toLowerCase()),
    );
    let cloudSchemaNotice;

    if (
        connection.dataSource === 'clickhouse' &&
        connection.id !== PLAYGROUND_CONNECTION_ID &&
        trusted &&
        !schemaLoading
    ) {
        if (schemaError) {
            cloudSchemaNotice = {
                message: schemaLoaded
                    ? copy.sqlExamplesSchemaRefreshFailed
                    : copy.sqlExamplesSchemaUnavailable,
                error: true,
            };
        } else if (schemaLoaded && !visibleTables) {
            cloudSchemaNotice = { message: copy.sqlExamplesNoTables, error: false };
        } else {
            cloudSchemaNotice = undefined;
        }
    } else {
        cloudSchemaNotice = undefined;
    }

    useEffect(() => {
        if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    }, [selected, selectedId]);

    useEffect(() => {
        if (!open) return;
        setSearch('');
        setCategory(featuredExamples.length ? 'featured' : 'all');
        setSelectedId(defaultExample?.id ?? '');

        const previousOverflow = document.body.style.overflow;
        const appRoot = document.getElementById('root');
        const previousInert = appRoot?.inert ?? false;
        document.body.style.overflow = 'hidden';
        if (appRoot) appRoot.inert = true;
        const focusFrame = window.requestAnimationFrame(() => {
            const currentSection = sectionRef.current;
            if (currentSection === 'examples') {
                searchRef.current?.focus();
                return;
            }
            if (currentSection === 'storage') {
                panelRef.current
                    ?.querySelector<HTMLElement>('.help-parts-table-picker select:not(:disabled)')
                    ?.focus();
                return;
            }
            const activePanel = panelRef.current?.querySelector<HTMLElement>(
                '#workspace-help-panel-' + currentSection,
            );
            const firstAction = activePanel?.querySelector<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            (firstAction ?? tabRefs.current.get(currentSection))?.focus();
        });
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== 'Tab') return;

            const panel = panelRef.current;
            if (!panel) return;
            const focusable = Array.from(
                panel.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
            ).filter(element => !element.closest('[hidden]'));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const focusIsOutside = !panel.contains(document.activeElement);
            if (!first || !last) {
                event.preventDefault();
                panel.focus();
            } else if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = previousOverflow;
            if (appRoot) appRoot.inert = previousInert;
        };
    }, [defaultExample?.id, featuredExamples.length, open, onClose]);

    const handleTabKeyDown = (
        event: ReactKeyboardEvent<HTMLButtonElement>,
        current: HelpPanelSection,
    ) => {
        const currentIndex = sections.findIndex(item => item.id === current);
        let nextIndex: number | undefined;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
            nextIndex = (currentIndex + 1) % sections.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
            nextIndex = (currentIndex - 1 + sections.length) % sections.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = sections.length - 1;
        if (nextIndex === undefined) return;
        event.preventDefault();
        const next = sections[nextIndex]!.id;
        onSectionChange(next);
        window.requestAnimationFrame(() => tabRefs.current.get(next)?.focus());
    };

    const renderTabPanel = (id: HelpPanelSection, className: string, children: ReactNode) => (
        <div
            id={'workspace-help-panel-' + id}
            className={cx('workspace-help-tabpanel', className)}
            role="tabpanel"
            aria-labelledby={'workspace-help-tab-' + id}
            hidden={section !== id}
        >
            {children}
        </div>
    );
    const tourSections = sections.filter(item => item.id !== 'tour');
    const standardTourSections = tourSections.filter(item => !item.experimental);
    const experimentalTourSections = tourSections.filter(item => item.experimental);
    const renderTourCard = (item: (typeof sections)[number]) => (
        <button
            type="button"
            key={item.id}
            className="workspace-help-feature-card"
            onClick={() => onSectionChange(item.id)}
        >
            <span className="workspace-help-feature-icon">
                <Icon name={item.icon} />
            </span>
            <span className="workspace-help-feature-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
            </span>
            <span className="workspace-help-feature-arrow">›</span>
        </button>
    );

    return {
        panelRef,
        searchRef,
        tabRefs,
        optionRefs,
        sections,
        explainActions,
        search,
        setSearch,
        category,
        setCategory,
        setSelectedId,
        filteredExamples,
        selected,
        selectedIsScript,
        availableCategories,
        cloudSchemaNotice,
        handleTabKeyDown,
        renderTabPanel,
        standardTourSections,
        experimentalTourSections,
        renderTourCard,
    };
}
