import { Fragment } from 'react';
import { OverlayPortal } from './OverlayPortal';
import { Button, Icon, cx } from './ui';
import type { WorkspaceHelpPanelProps } from './help/workspace-help-types';
import { useWorkspaceHelpPanel } from './help/useWorkspaceHelpPanel';
import { HelpSections } from './help/HelpSections';

export type { HelpPanelSection } from './workspace-help-model';
export type { HelpExplainAction } from './help/workspace-help-types';
export function WorkspaceHelpPanel(props: WorkspaceHelpPanelProps) {
    const {
        sourceLabel,
        copy,
        experimentalLabel,
        open,
        section,
        onSectionChange,
        onClose,
        onStartBlankSql,
    } = props;
    const {
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
    } = useWorkspaceHelpPanel(props);
    return (
        <>
            {open && (
                <OverlayPortal>
                    <div
                        className="workspace-help-backdrop"
                        onClick={event => {
                            if (event.target === event.currentTarget) onClose();
                        }}
                    >
                        <section
                            ref={panelRef}
                            id="workspace-help-panel"
                            className="workspace-help-panel"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="workspace-help-title"
                            tabIndex={-1}
                        >
                            <header className="workspace-help-header">
                                <div>
                                    <span className="eyebrow">{sourceLabel}</span>
                                    <h2 id="workspace-help-title">{copy.helpCenterTitle}</h2>
                                    <p>{copy.helpCenterDescription}</p>
                                </div>
                                <div className="workspace-help-header-actions">
                                    <Button
                                        variant="primary"
                                        className="sql-example-blank"
                                        data-testid="blank-sql"
                                        onClick={() => {
                                            if (onStartBlankSql()) onClose(false);
                                        }}
                                    >
                                        <Icon name="plus" />
                                        {copy.startBlankSql}
                                    </Button>
                                    <button
                                        type="button"
                                        className="workspace-help-close"
                                        aria-label={copy.closeHelp}
                                        title={copy.closeHelp}
                                        onClick={() => onClose()}
                                    >
                                        <Icon name="close" />
                                    </button>
                                </div>
                            </header>
                            <div className="workspace-help-body">
                                <div
                                    className="workspace-help-tabs"
                                    role="tablist"
                                    aria-label={copy.helpPanelSections}
                                >
                                    {sections.map((item, index) => (
                                        <Fragment key={item.id}>
                                            {item.experimental &&
                                                !sections[index - 1]?.experimental && (
                                                    <div
                                                        className="workspace-help-tabs-group-label"
                                                        role="presentation"
                                                        aria-hidden="true"
                                                    >
                                                        <span className="workspace-help-experimental-indicator" />
                                                        {experimentalLabel}
                                                    </div>
                                                )}
                                            <button
                                                ref={element => {
                                                    if (element)
                                                        tabRefs.current.set(item.id, element);
                                                    else tabRefs.current.delete(item.id);
                                                }}
                                                id={'workspace-help-tab-' + item.id}
                                                data-testid={'help-section-' + item.id}
                                                type="button"
                                                role="tab"
                                                aria-label={
                                                    item.experimental
                                                        ? `${experimentalLabel}: ${item.label}`
                                                        : item.label
                                                }
                                                aria-selected={section === item.id}
                                                aria-controls={'workspace-help-panel-' + item.id}
                                                tabIndex={section === item.id ? 0 : -1}
                                                className={cx(
                                                    'workspace-help-tab',
                                                    item.experimental && 'is-experimental',
                                                    section === item.id && 'is-active',
                                                )}
                                                onClick={() => onSectionChange(item.id)}
                                                onKeyDown={event =>
                                                    handleTabKeyDown(event, item.id)
                                                }
                                            >
                                                <Icon name={item.icon} />
                                                <span className="workspace-help-tab-copy">
                                                    <span className="workspace-help-tab-title">
                                                        <strong>{item.label}</strong>
                                                        {item.experimental && (
                                                            <span
                                                                className="workspace-help-tab-short-tag"
                                                                aria-hidden="true"
                                                            >
                                                                EXP
                                                            </span>
                                                        )}
                                                    </span>
                                                    <small>{item.description}</small>
                                                </span>
                                            </button>
                                        </Fragment>
                                    ))}
                                </div>
                                <HelpSections
                                    {...{
                                        renderTabPanel,
                                        standardTourSections,
                                        renderTourCard,
                                        experimentalTourSections,
                                        props,
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
                                        explainActions,
                                    }}
                                />
                            </div>
                        </section>
                    </div>
                </OverlayPortal>
            )}
        </>
    );
}
