import { useEffect, useRef } from 'react';
import type { Locale } from '../i18n';
import { Button, Icon } from './ui';

export function RestoreRevisionDialog({ revision, locale, onClose, onConfirm }: {
    revision?: number;
    locale: Locale;
    onClose: () => void;
    onConfirm: () => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const copy = locale === 'zh' ? {
        eyebrow: '恢复版本',
        version: (value: number) => `版本 ${value}`,
        title: (version: number) => `用版本 ${version} 替换当前草稿？`,
        description: '当前未保存的 SQL 草稿将被替换。恢复的 SQL 会另存为一个新版本。',
        selectedVersion: '所选版本',
        history: '恢复的版本会保留在版本历史中。',
        cancel: '保留草稿',
        confirm: (version: number) => `恢复版本 ${version}`,
        close: '关闭恢复确认',
    } : {
        eyebrow: 'VERSION RESTORE',
        version: (value: number) => `Version ${value}`,
        title: (version: number) => `Replace your draft with Version ${version}?`,
        description: 'This replaces your current unsaved SQL draft. The restored SQL is saved as a new version.',
        selectedVersion: 'Selected version',
        history: 'Your saved versions remain in version history.',
        cancel: 'Keep draft',
        confirm: (version: number) => `Restore Version ${version}`,
        close: 'Close restore confirmation',
    };

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (revision !== undefined && !dialog.open) {
            dialog.showModal();
            dialog.querySelector<HTMLButtonElement>('.restore-revision-actions .button-secondary')?.focus();
        } else if (revision === undefined && dialog.open) {
            dialog.close();
        }
    }, [revision]);

    return <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="restore-revision-title"
        aria-describedby="restore-revision-description"
        className="restore-revision-dialog"
        onCancel={event => { event.preventDefault(); onClose(); }}
        onClick={event => { if (event.target === dialogRef.current) onClose(); }}
    >
        {revision !== undefined && <div className="restore-revision-content">
            <div className="restore-revision-topline"><span>{copy.eyebrow}</span><Button variant="ghost" className="restore-revision-close" aria-label={copy.close} onClick={onClose}><Icon name="close"/></Button></div>
            <div className="restore-revision-title-row"><span className="restore-revision-icon"><Icon name="history"/></span><div><h2 id="restore-revision-title">{copy.title(revision)}</h2><p id="restore-revision-description">{copy.description}</p></div></div>
            <div className="restore-revision-summary"><span>{copy.selectedVersion}</span><strong>{copy.version(revision)}</strong></div>
            <p className="restore-revision-history-note">{copy.history}</p>
            <div className="restore-revision-actions"><Button variant="secondary" onClick={onClose}>{copy.cancel}</Button><Button variant="primary" onClick={onConfirm}>{copy.confirm(revision)}</Button></div>
        </div>}
    </dialog>;
}
