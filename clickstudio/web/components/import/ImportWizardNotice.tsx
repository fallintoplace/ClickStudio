import { useImportWizardController } from '../useImportWizardController';
import { Spinner } from '../ui';

export function ImportWizardNotice({
    browserDemoImport,
    error,
    recoveryState,
    errorAlertRef,
    importUnavailable,
    busy,
    step,
}: {
    browserDemoImport: boolean;
    error: string;
    recoveryState: ReturnType<typeof useImportWizardController>['recoveryState'];
    errorAlertRef: import('react').RefObject<HTMLParagraphElement | null>;
    importUnavailable: string;
    busy: ReturnType<typeof useImportWizardController>['busy'];
    step: ReturnType<typeof useImportWizardController>['step'];
}) {
    return (
        <>
            {browserDemoImport && (
                <div
                    role="status"
                    className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-3 text-xs leading-relaxed text-[var(--text-soft)]"
                >
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--accent)]" />
                    <span>
                        <strong className="text-[var(--text)]">Vercel demo mode.</strong> Your file
                        stays in this browser and is added to{' '}
                        <code className="font-mono">demo.interview_imports</code>. Nothing is
                        written to the public ClickHouse Playground.
                    </span>
                </div>
            )}
            {error && recoveryState !== 'failed' && (
                <p
                    ref={errorAlertRef}
                    role="alert"
                    tabIndex={-1}
                    className="mb-4 whitespace-pre-wrap break-words rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs leading-relaxed text-[var(--red)] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[var(--red)]"
                >
                    {error}
                </p>
            )}
            {recoveryState === 'checking' && (
                <div className="import-loading-state">
                    <Spinner label="Loading import" />
                </div>
            )}
            {recoveryState === 'failed' && (
                <div
                    role="alert"
                    className="rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/5 p-4 text-sm text-[var(--red)]"
                >
                    <p>
                        {error ||
                            'Could not check whether an earlier import finished. Close and reopen the importer to check again.'}
                    </p>
                </div>
            )}
            {recoveryState === 'ready' && importUnavailable && (
                <div
                    role="status"
                    className="rounded-xl border border-[var(--line)] bg-[var(--page)] p-4 text-sm text-[var(--text-soft)]"
                >
                    {importUnavailable}
                </div>
            )}
            {recoveryState === 'ready' && busy === 'setup' && (
                <div className="import-loading-state">
                    <Spinner label="Loading destination tables" />
                </div>
            )}
            {recoveryState === 'ready' && busy === 'recover' && step === 'status' && (
                <div className="import-loading-state">
                    <Spinner label="Checking import status" />
                </div>
            )}
        </>
    );
}
