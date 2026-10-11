import type { Connection } from '../../shared/database/connections/types.js';
import type { Principal } from '../../shared/common/identity.js';

export type Connected = Connection & { trusted: boolean };
export type Session = {
    principal: Principal | null;
    requiresLogin: boolean;
    demo: boolean;
    cloudConnectionPersistence?: 'local-server';
};
export const INSPECTORS = [
    'schema',
    'reference',
    'history',
    'documents',
    'revisions',
    'details',
    'profile',
    'pipeline',
    'parser',
    'assistant',
] as const;
export type Inspector = (typeof INSPECTORS)[number];
export const RESULTS_VIEWS = [
    'results',
    'chart',
    'map',
    'insights',
    'sqlmap',
    'indexes',
    'plan',
    'pipeline',
    'runtime',
] as const;
export type ResultsView = (typeof RESULTS_VIEWS)[number];
export type BusyAction = 'run' | 'script' | 'save' | '';
export type WorkspaceFormatter = 'wasm' | 'builtin';
export type WorkspaceRunCapabilityAction =
    'script' | 'explain' | 'explain-plan' | 'explain-pipeline' | 'explain-analyze';
export type WorkspaceRunCapability = Readonly<{ available: boolean; reason?: string }>;
export type WorkspaceActionRef = { current: () => Promise<void> };
export type RunEventState = 'idle' | 'live' | 'reconnecting';
export type SelectOption<Value extends string> = { value: Value; label: string };
export type ImportedTableTarget = {
    id: string;
    table: string;
    source: 'rows' | 'sql' | 'partial';
    rows?: number;
};
