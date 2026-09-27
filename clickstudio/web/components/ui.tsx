import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Run } from '../../shared/types';
import type { Inspector, SelectOption } from '../workspace-types';
import type { Copy } from '../i18n';

export const terminal = (run?: Run) => Boolean(run && ['succeeded', 'truncated', 'failed', 'cancelled', 'timed_out', 'interrupted'].includes(run.status));

export function cx(...values: Array<string | false | undefined>) { return values.filter(Boolean).join(' '); }

const iconPaths = {
    schema: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10m6-10v10"/></>,
    view: <><path d="M3 12s3.3-5 9-5 9 5 9 5-3.3 5-9 5-9-5-9-5Z"/><circle cx="12" cy="12" r="2.2"/></>,
    column: <><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M10 7h4m-4 5h4m-4 5h4"/></>,
    projection: <><rect x="4" y="7" width="13" height="13" rx="2"/><path d="M8 4h12v12"/></>,
    index: <><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></>,
    dictionary: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z"/><path d="M4 6h12M8 9h8m-8 4h6"/></>,
    reference: <><path d="M5 3.5h9l5 5V21H5z"/><path d="M14 3.5v5h5M8 12h8m-8 3h8m-8 3h5"/></>,
    moon: <path d="M20.9 13A8.9 8.9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
    history: <><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5m4-1v5l3 2"/></>,
    assistant: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></>,
    chart: <><path d="M4 19V5m0 14h17"/><path d="m7 15 4-4 3 2 6-7"/></>,
    details: <><path d="M4 19V5m0 14h16"/><path d="m7 15 3-4 3 2 5-7"/><circle cx="18" cy="6" r="1"/></>,
    observability: <><path d="M3 12h4l2.2-6 4.1 12 2.4-7H21"/><circle cx="9.2" cy="6" r="1"/><circle cx="13.3" cy="18" r="1"/></>,
    pipeline: <><rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/><rect x="15" y="4" width="6" height="5" rx="1"/><path d="M9 6.5h3a3 3 0 0 1 3 3V15"/></>,
    parser: <><path d="m8 5-5 7 5 7m8-14 5 7-5 7m-1-16-4 18"/></>,
    documents: <><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7m-7 4h7"/></>,
    examples: <><path d="M12 7v14"/><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H12v18H5.5A2.5 2.5 0 0 0 3 23V5.5Z"/><path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H12v18h6.5A2.5 2.5 0 0 1 21 23V5.5Z"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.6 2.77-.08-.02a1.7 1.7 0 0 0-1.8.72l-.04.07h-3.2l-.03-.08a1.7 1.7 0 0 0-1.54-1.1 1.7 1.7 0 0 0-1.45.75l-.04.07-2.77-1.6.02-.08a1.7 1.7 0 0 0-.72-1.8l-.07-.04v-3.2l.08-.03a1.7 1.7 0 0 0 1.1-1.54 1.7 1.7 0 0 0-.75-1.45l-.07-.04 1.6-2.77.08.02a1.7 1.7 0 0 0 1.8-.72l.04-.07h3.2l.03.08a1.7 1.7 0 0 0 1.54 1.1 1.7 1.7 0 0 0 1.45-.75l.04-.07 2.77 1.6-.02.08a1.7 1.7 0 0 0 .72 1.8l.07.04v3.2l-.08.03a1.7 1.7 0 0 0-.66.74Z"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    more: <><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></>,
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    chevron: <path d="m8 10 4 4 4-4"/>,
    floatPanel: <><rect x="3" y="8" width="13" height="12" rx="2"/><path d="M3 12h13"/><rect x="9" y="3" width="12" height="12" rx="2"/><path d="M9 7h12"/></>,
    newWindow: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M13 3h8v8M21 3l-9 9"/></>,
    dock: <><rect x="4" y="5" width="16" height="14" rx="2"/><path d="m15 9-5 5m0 0h4m-4 0v-4"/></>,
    maximize: <path d="M5 9V5h4m6 0h4v4m0 6v4h-4m-6 0H5v-4"/>,
    restore: <><rect x="5" y="7" width="12" height="12" rx="1.5"/><path d="M8 7V5h11v11h-2"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/></>,
    importFile: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></>,
    exportFile: <><path d="M12 15V3m0 0 4 4m-4-4-4 4"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    mic: <><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5v3m-4 0h8"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.4 2.4 0 1 1 4.1 1.7c-1 .9-1.8 1.2-1.8 2.8"/><path d="M12 17.5h.01"/></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof iconPaths;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
    return <svg aria-hidden="true" className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
    const variants = {
        primary: 'button-primary',
        secondary: 'button-secondary',
        ghost: 'button-ghost',
        danger: 'button-danger',
    };
    return <button {...props} type={type} className={cx('button-base', variants[variant], className)} />;
}

export function Status({ run, copy }: { run?: Run; copy?: Copy['common'] }) {
    const kind = terminal(run) ? run?.status === 'succeeded' ? 'is-trusted' : run?.status === 'truncated' ? 'is-warning' : 'is-error' : 'is-running';
    const statusCopy: Partial<Record<NonNullable<Run>['status'], keyof Copy['common']>> = {
        queued: 'statusQueued', running: 'statusRunning', succeeded: 'statusSucceeded', truncated: 'statusTruncated', failed: 'statusFailed',
        cancelled: 'statusCancelled', timed_out: 'statusTimedOut', interrupted: 'statusInterrupted',
    };
    const key = run ? statusCopy[run.status] : undefined;
    const label = key && copy ? copy[key] : run?.status ?? copy?.statusReady ?? 'Ready';
    return <span data-run-status={run?.status ?? 'ready'} className="inline-flex items-center gap-2 text-[11px] capitalize text-muted"><span className={cx('status-light', kind)}/>{label}</span>;
}

export function SelectControl<Value extends string>({ label, value, options, onChange }: { label: string; value: Value; options: readonly SelectOption<Value>[]; onChange: (value: Value) => void }) {
    const selectOption = (rawValue: string) => {
        const option = options.find(candidate => candidate.value === rawValue);
        if (option) onChange(option.value);
    };
    return <label className="select-control"><span>{label}</span><select value={value} onChange={event => selectOption(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Icon name="chevron" className="select-chevron"/></label>;
}


export function formatBytes(value?: string | number): string {
    if (value === undefined) return '—';
    const bytes = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(bytes)) return String(value);
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes.toLocaleString()} B`;
}

export function formatCount(value: string | number): string {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(number) : String(value);
}

export function inspectorLabel(value: Inspector): string { return ({ schema: 'Schema explorer', reference: 'Reference', history: 'Run history', documents: 'Documents', revisions: 'Version history', details: 'Run details', profile: 'Query profile', pipeline: 'Pipeline', parser: 'ClickHouse parser', assistant: 'AI copilot' })[value]; }
