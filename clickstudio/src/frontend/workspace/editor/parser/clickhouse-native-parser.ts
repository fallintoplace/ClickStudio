import type {
    NativeFormatResult,
    NativeParseResult,
    NativeParserReply,
    NativeParserRequest,
    NativeParserStatus,
    NativeParserWorkerStatus,
} from '../../../../shared/sql/parser';

type Pending<T> = { resolve: (value: T[]) => void; reject: (error: Error) => void };

class ClickHouseNativeParser {
    private worker?: Worker;
    private nextId = 1;
    private pendingParses = new Map<number, Pending<NativeParseResult>>();
    private pendingFormats = new Map<number, Pending<NativeFormatResult>>();
    private listeners = new Set<(status: NativeParserStatus) => void>();
    private state: NativeParserStatus = 'loading';
    private reason = '';

    get status(): NativeParserStatus {
        return this.state;
    }

    subscribe(listener: (status: NativeParserStatus) => void): () => void {
        this.listeners.add(listener);
        listener(this.state);
        this.ensureWorker();
        return () => {
            this.listeners.delete(listener);
        };
    }

    parseMany(sql: string[]): Promise<NativeParseResult[]> {
        return this.request('parseMany', sql, this.pendingParses);
    }

    formatMany(sql: string[]): Promise<NativeFormatResult[]> {
        return this.request('formatMany', sql, this.pendingFormats);
    }

    retry() {
        if (this.state !== 'unavailable') return;
        this.worker?.terminate();
        this.worker = undefined;
        this.setStatus('loading');
        try {
            this.ensureWorker();
        } catch (error) {
            this.setStatus('unavailable', error instanceof Error ? error.message : String(error));
        }
    }

    private ensureWorker(): Worker {
        if (this.worker) return this.worker;
        const worker = new Worker(
            new URL('./clickhouse-native-parser.worker.ts', import.meta.url),
            {
                type: 'module',
                name: 'clickhouse-native-parser',
            },
        );
        worker.addEventListener(
            'message',
            (event: MessageEvent<NativeParserReply | NativeParserWorkerStatus>) => {
                const data = event.data;
                if (data.kind === 'status') {
                    this.setStatus(data.status, data.reason);
                    return;
                }
                if (data.kind === 'parseMany') {
                    const pending = this.pendingParses.get(data.id);
                    if (!pending) return;
                    this.pendingParses.delete(data.id);
                    if (data.ok) pending.resolve(data.results);
                    else pending.reject(new Error(data.message));
                    return;
                }
                const pending = this.pendingFormats.get(data.id);
                if (!pending) return;
                this.pendingFormats.delete(data.id);
                if (data.ok) pending.resolve(data.results);
                else pending.reject(new Error(data.message));
            },
        );
        worker.addEventListener('error', event => {
            this.setStatus('unavailable', event.message || 'Native parser worker failed');
            this.rejectPending(this.reason);
        });
        this.worker = worker;
        return worker;
    }

    private request<T>(
        kind: NativeParserRequest['kind'],
        sql: string[],
        pending: Map<number, Pending<T>>,
    ): Promise<T[]> {
        if (this.state === 'unavailable')
            return Promise.reject(
                new Error(this.reason || 'ClickHouse native parser is unavailable'),
            );
        const worker = this.ensureWorker(),
            id = this.nextId++;
        return new Promise<T[]>((resolve, reject) => {
            pending.set(id, { resolve, reject });
            const message: NativeParserRequest = { id, kind, sql };
            worker.postMessage(message);
        });
    }

    private setStatus(status: NativeParserStatus, reason = '') {
        if (status === this.state && reason === this.reason) return;
        this.state = status;
        this.reason = reason;
        for (const listener of this.listeners) listener(status);
        if (status === 'unavailable')
            this.rejectPending(reason || 'ClickHouse native parser is unavailable');
    }

    private rejectPending(message: string) {
        for (const request of this.pendingParses.values()) request.reject(new Error(message));
        for (const request of this.pendingFormats.values()) request.reject(new Error(message));
        this.pendingParses.clear();
        this.pendingFormats.clear();
    }
}

export const clickHouseNativeParser = new ClickHouseNativeParser();
