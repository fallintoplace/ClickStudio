import { useState } from 'react';
import type { Connection, SchemaTable } from '../../shared/types';
import type { Copy } from '../i18n';
import { PartsExplorer } from './PartsExplorer';
import { StorageActivityView } from './StorageActivityView';
import { NativeExplorerDialog } from './NativeExplorerDialog';

export function StorageExplorer({
    connection,
    table,
    copy,
    onClose,
    embedded = false,
    active = true,
}: {
    connection: Pick<Connection, 'id' | 'dataSource'>;
    table: SchemaTable;
    copy: Copy['common'];
    onClose?: () => void;
    embedded?: boolean;
    active?: boolean;
}) {
    const [tab, setTab] = useState<'parts' | 'merges' | 'mutations'>('parts');
    const content = (
        <div className="native-storage">
            <div className="native-tabs" role="group" aria-label="Storage views">
                {(['parts', 'merges', 'mutations'] as const).map(value => (
                    <button
                        type="button"
                        key={value}
                        aria-pressed={tab === value}
                        onClick={() => setTab(value)}
                    >
                        {value === 'parts' ? 'Parts' : value === 'merges' ? 'Merges' : 'Mutations'}
                    </button>
                ))}
            </div>
            {tab === 'parts' ? (
                <PartsExplorer embedded connection={connection} table={table} copy={copy} />
            ) : (
                <StorageActivityView
                    connection={connection}
                    table={table}
                    kind={tab}
                    active={active}
                />
            )}
        </div>
    );
    return embedded ? (
        content
    ) : (
        <NativeExplorerDialog
            closeLabel={copy.closePanel}
            title={copy.partsExplorerTitle}
            description="Parts · Merges · Mutations"
            onClose={() => onClose?.()}
        >
            {content}
        </NativeExplorerDialog>
    );
}
