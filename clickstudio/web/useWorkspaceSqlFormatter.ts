import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { formatSql } from '../shared/sql';
import type { NativeParserStatus } from '../shared/native-parser';
import type { WorkspaceFormatter } from './workspace-types';
import type { EditorHandle } from './components/SqlEditor';
import type { Draft, WorkspaceState } from './workspace-state';

export function useWorkspaceSqlFormatter(
    active: Pick<Draft, 'id' | 'sql'>,
    setWorkspace: Dispatch<SetStateAction<WorkspaceState>>,
    editor: RefObject<EditorHandle | null>,
    nativeParserEnabled: boolean,
    nativeParserStatus: NativeParserStatus,
) {
    return useCallback(async (formatter: WorkspaceFormatter) => {
        const draftId = active.id, sourceSql = active.sql;
        const applyBuiltIn = () => setWorkspace(current => current.activeId !== draftId ? current : ({ ...current,
            tabs: current.tabs.map(draft => draft.id === draftId && draft.sql === sourceSql ? { ...draft, sql: formatSql(sourceSql) } : draft),
        }));
        if (formatter === 'builtin') {
            applyBuiltIn();
            return;
        }
        if (!nativeParserEnabled || nativeParserStatus !== 'ready') return;
        const result = await editor.current?.formatNative();
        if (result === 'unavailable' || result === 'fallback')
            applyBuiltIn();
    }, [active.id, active.sql, editor, nativeParserEnabled, nativeParserStatus, setWorkspace]);
}
