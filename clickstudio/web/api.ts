import type { ApiError } from '../shared/types';
import { CLICKHOUSE_CLOUD_CONNECTION_ID, getClickHouseCloudConnection } from './cloud-connection';
import { DemoPreviewApi } from './demo-preview';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ApiOptions = {
    method?: HttpMethod;
    body?: unknown;
    signal?: AbortSignal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApiError(value: unknown): value is ApiError {
    return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string' &&
        (value.remediation === undefined || typeof value.remediation === 'string') &&
        (value.position === undefined || typeof value.position === 'number');
}

export class RequestError extends Error {
    constructor(public readonly status: number, public readonly detail: ApiError) { super(detail.message); }
}

export const isFrontendDemoPreview = import.meta.env.VITE_DEMO_MODE === 'true';
const demoPreview = isFrontendDemoPreview ? new DemoPreviewApi() : undefined;
let cloudWorkspacePreview: DemoPreviewApi | undefined;

function usesCloudWorkspacePreview(path: string) {
    const pathname = path.split(/[?#]/, 1)[0] ?? path;
    return pathname === '/documents' || pathname.startsWith('/documents/') ||
        pathname === '/runs' || pathname.startsWith('/runs/') ||
        pathname === '/scripts' || pathname.startsWith('/scripts/') ||
        pathname.startsWith('/connections/clickhouse-cloud/');
}

function isCloudWorkspaceSelected() {
    return typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('connection') === CLICKHOUSE_CLOUD_CONNECTION_ID &&
        Boolean(getClickHouseCloudConnection());
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
    if (demoPreview && path !== '/assistant/sql')
        return await demoPreview.request(path, options) as T;
    if (!demoPreview && isCloudWorkspaceSelected() && usesCloudWorkspacePreview(path)) {
        cloudWorkspacePreview ??= new DemoPreviewApi();
        return await cloudWorkspacePreview.request(path, options) as T;
    }

    const response = await fetch(`/api${path}`, { method: options.method ?? 'GET', credentials: 'same-origin', signal: options.signal,
        headers: { 'X-ClickStudio-Intent': '1', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    const content: unknown = await response.json().catch(() => null);
    if (!response.ok) {
        const detail = isRecord(content) && isApiError(content.error) ? content.error : {
            code: 'NETWORK_RESPONSE', message: `The server returned HTTP ${response.status}`,
        };
        throw new RequestError(response.status, detail);
    }
    return content as T;
}
export const post = <T,>(path: string, body: unknown = {}, options: Pick<ApiOptions, 'signal'> = {}) => api<T>(path, { method: 'POST', body, ...options });
export function download(name: string, value: unknown, type = 'application/json') { const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2); const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function message(error: unknown) { return error instanceof RequestError ? `${error.detail.code}: ${error.message}` : error instanceof Error ? error.message : String(error); }
