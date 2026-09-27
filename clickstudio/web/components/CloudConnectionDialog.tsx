import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Connection } from '../../shared/types';
import { connectClickHouseCloud, loadSavedCloudConnectionProfile, saveCloudConnectionProfile, type CloudCredentials } from '../cloud-connection';
import type { Connected } from '../workspace-types';
import { Button, Icon } from './ui';
import { OverlayPortal } from './OverlayPortal';

export function CloudConnectionDialog({ onClose, onConnect }: { onClose: () => void; onConnect: (connection: Connection & { trusted: boolean }) => void }) {
    const [savedProfile] = useState(loadSavedCloudConnectionProfile);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const dialog = useRef<HTMLElement>(null);
    const close = useRef(onClose);
    close.current = onClose;

    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        const root = dialog.current;
        root?.focus();
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) {
                event.preventDefault();
                close.current();
            }
            if (event.key !== 'Tab' || !root) return;
            const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
                .filter(element => element.getClientRects().length > 0);
            const first = controls[0], last = controls.at(-1);
            if (!first) { event.preventDefault(); root.focus(); }
            else if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        root?.addEventListener('keydown', keydown);
        return () => { root?.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
    }, [busy]);

    const connect = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        const form = new FormData(event.currentTarget);
        const host = String(form.get('host') ?? '');
        const database = String(form.get('database') ?? '');
        const username = String(form.get('username') ?? '');
        const password = String(form.get('password') ?? '');
        const credentials: CloudCredentials = { host, database, username, password };
        try {
            const connection: Connected = await connectClickHouseCloud(credentials);
            saveCloudConnectionProfile({ host, database, username });
            onConnect(connection);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not connect to ClickHouse Cloud.');
        } finally {
            setBusy(false);
        }
    };

    return <OverlayPortal>
        <div className="cloud-connect-layer">
            <button type="button" className="cloud-connect-scrim" aria-label="Close connection dialog" onClick={() => { if (!busy) onClose(); }}/>
            <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cloud-connect-title" aria-describedby="cloud-connect-description" className="cloud-connect-dialog">
                <header className="cloud-connect-heading">
                    <div><span className="eyebrow">CLICKHOUSE CLOUD</span><h2 id="cloud-connect-title">Connect to your service</h2></div>
                    <Button variant="ghost" aria-label="Close connection dialog" disabled={busy} onClick={onClose}><Icon name="close"/></Button>
                </header>
                <p id="cloud-connect-description" className="cloud-connect-description">Use the HTTPS host and user credentials from the service’s Connect dialog. ClickStudio checks the connection before opening the workspace.</p>
                <form className="cloud-connect-form" onSubmit={event => void connect(event)} autoComplete="on">
                    <label className="field-label">HTTPS host<input className="field-input" name="host" defaultValue={savedProfile?.host ?? ''} placeholder="service.region.provider.clickhouse.cloud:8443" autoComplete="off" autoCapitalize="none" spellCheck={false} required autoFocus/></label>
                    <div className="cloud-connect-fields">
                        <label className="field-label">Database<input className="field-input" name="database" defaultValue={savedProfile?.database ?? 'default'} autoComplete="off" required/></label>
                        <label className="field-label">Username<input className="field-input" name="username" defaultValue={savedProfile?.username ?? 'default'} autoComplete="username" required/></label>
                    </div>
                    <label className="field-label">Password<input className="field-input" name="password" type="password" autoComplete="current-password" required/></label>
                    <div className="cloud-connect-notice"><Icon name="lock"/><span>The host, database, and username from your last successful connection are saved in this browser. ClickStudio never saves the password; your browser’s password manager can fill it after a refresh. The password stays in this tab’s memory, is sent over HTTPS with each request, and is cleared on reload or disconnect. Your ClickHouse user’s permissions control what SQL can change.</span></div>
                    {error && <div className="callout callout-error cloud-connect-error" role="alert">{error}</div>}
                    <div className="cloud-connect-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? <><span className="loading-orbit" aria-hidden="true"/> Connecting…</> : 'Connect service'}</Button></div>
                </form>
            </section>
        </div>
    </OverlayPortal>;
}
