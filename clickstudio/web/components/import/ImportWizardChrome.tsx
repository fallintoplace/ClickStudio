import { importSteps } from '../import-wizard-model';
import { useImportWizardController } from '../useImportWizardController';
import { Icon } from '../ui';

export function ImportWizardHeader({
    browserDemoImport,
    browserCloudImport,
    importKind,
    openingQuery,
    busy,
    job,
    closeQueryMode,
    closeWizard,
}: {
    browserDemoImport: boolean;
    browserCloudImport: boolean;
    importKind: 'rows' | 'query';
    openingQuery: boolean;
    busy: ReturnType<typeof useImportWizardController>['busy'];
    job: ReturnType<typeof useImportWizardController>['job'];
    closeQueryMode: () => void;
    closeWizard: ReturnType<typeof useImportWizardController>['closeWizard'];
}) {
    const getImportSourceLabel = () => {
        if (browserDemoImport) {
            return 'Interview demo · browser sandbox';
        }

        if (browserCloudImport) {
            return 'ClickHouse Cloud';
        }

        return 'ClickHouse data';
    };
    const getImportDescription = () => {
        if (importKind === 'query') {
            return 'Open a SQL file as a new draft. It will not run until you choose Run.';
        }

        if (browserDemoImport) {
            return 'Preview, map, and save rows into this browser’s sample dataset.';
        }

        if (browserCloudImport) {
            return 'Preview, map, and import rows with your connected Cloud account.';
        }

        return 'Preview, map, and review rows before inserting them.';
    };
    return (
        <header className="import-wizard-header flex items-start justify-between gap-5 border-b border-[var(--line)] px-5 py-4 sm:px-7">
            <div className="min-w-0">
                <span className="import-wizard-eyebrow text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                    {getImportSourceLabel()}
                </span>
                <h2
                    id="import-wizard-title"
                    className="import-wizard-title mt-1 text-lg font-semibold tracking-tight"
                >
                    Import data
                </h2>
                <p className="import-wizard-description mt-1 text-xs text-[var(--text-soft)]">
                    {getImportDescription()}
                </p>
            </div>
            <button
                type="button"
                aria-label="Close import wizard"
                disabled={
                    openingQuery ||
                    (importKind === 'rows' &&
                        !browserCloudImport &&
                        (Boolean(busy) || job?.status === 'running'))
                }
                onClick={() => (importKind === 'query' ? closeQueryMode() : void closeWizard())}
                className="import-wizard-close rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] transition hover:bg-[var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
                Close
            </button>
        </header>
    );
}

export function ImportKindSelector({
    importKind,
    setImportKind,
    openingQuery,
}: {
    importKind: 'rows' | 'query';
    setImportKind: (kind: 'rows' | 'query') => void;
    openingQuery: boolean;
}) {
    return (
        <div role="group" aria-label="Import type" className="import-kind-choice">
            <button
                type="button"
                aria-pressed={importKind === 'rows'}
                disabled={openingQuery}
                className={`import-kind-button is-rows${importKind === 'rows' ? ' is-selected' : ''}`}
                onClick={() => setImportKind('rows')}
            >
                <span className="import-kind-icon" aria-hidden="true">
                    <Icon name="importFile" />
                </span>
                <span className="import-kind-copy">
                    <strong>Rows</strong>
                    <small>CSV · JSON · NDJSON</small>
                </span>
            </button>
            <button
                type="button"
                aria-pressed={importKind === 'query'}
                disabled={openingQuery}
                className={`import-kind-button is-query${importKind === 'query' ? ' is-selected' : ''}`}
                onClick={() => setImportKind('query')}
            >
                <span className="import-kind-icon" aria-hidden="true">
                    <Icon name="parser" />
                </span>
                <span className="import-kind-copy">
                    <strong>Open SQL file</strong>
                    <small>Start a new query draft.</small>
                </span>
            </button>
        </div>
    );
}

export function ImportStepNavigation({
    step,
}: {
    step: ReturnType<typeof useImportWizardController>['step'];
}) {
    return (
        <nav
            aria-label="Import steps"
            className="import-wizard-steps grid grid-cols-4 border-b border-[var(--line)] bg-[var(--page)] px-3 py-2 sm:px-7"
        >
            {importSteps.map((item, index) => {
                const currentIndex = importSteps.findIndex(candidate => candidate.id === step);
                const isCurrent = step === item.id;
                const isComplete = currentIndex > index;
                return (
                    <div
                        key={item.id}
                        aria-current={isCurrent ? 'step' : undefined}
                        className={`import-step-item${isCurrent ? ' is-current' : ''}${isComplete ? ' is-complete' : ''}`}
                    >
                        <span className="import-step-number" aria-hidden="true">
                            {isComplete ? '✓' : index + 1}
                        </span>
                        <span className="import-step-label">{item.label}</span>
                    </div>
                );
            })}
        </nav>
    );
}
