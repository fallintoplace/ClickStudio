import type { Connection, Principal } from '../shared/types.js';

export type Connected = Connection & { trusted: boolean };
export type Session = { principal: Principal | null; requiresLogin: boolean; demo: boolean };
export type Inspector = 'schema' | 'reference' | 'history' | 'documents' | 'revisions' | 'details' | 'profile' | 'pipeline' | 'parser' | 'assistant';
export type ResultsView = 'results' | 'chart' | 'map' | 'insights' | 'sqlmap' | 'indexes' | 'plan' | 'pipeline' | 'runtime';
export type BusyAction = 'run' | 'script' | 'save' | '';
export type WorkspaceFormatter = 'wasm' | 'builtin';
export type WorkspaceRunCapabilityAction = 'script' | 'explain' | 'explain-plan' | 'explain-pipeline' | 'explain-analyze';
export type WorkspaceRunCapability = Readonly<{ available: boolean; reason?: string }>;
export type WorkspaceActionRef = { current: () => Promise<void> };
export type RunEventState = 'idle' | 'live' | 'reconnecting';
export type SelectOption<Value extends string> = { value: Value; label: string };
export type ImportedTableTarget = { id: string; table: string; source: 'rows' | 'sql'; rows?: number };
