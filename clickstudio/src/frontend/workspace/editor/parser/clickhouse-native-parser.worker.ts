import {
    parseNativeParseResult,
    type NativeFormatResult,
    type NativeParseResult,
    type NativeParserReply,
    type NativeParserRequest,
    type NativeParserWorkerStatus,
} from '../../../../shared/sql/parser';

type ParserExports = {
    memory: WebAssembly.Memory;
    _initialize?: () => void;
    ch_features: () => number;
    ch_alloc: (size: number) => number;
    ch_free: (ptr: number) => void;
    ch_parse: (ptr: number, size: number) => number;
    ch_format?: (ptr: number, size: number, oneLine: number) => number;
    ch_result_data: () => number;
    ch_result_size: () => number;
};
const worker = globalThis as unknown as {
    postMessage: (message: NativeParserReply | NativeParserWorkerStatus) => void;
    addEventListener: (
        type: 'message',
        listener: (event: MessageEvent<NativeParserRequest>) => void,
    ) => void;
};

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_NOSYS = 52;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const requiredParserFunctions = [
    'ch_features',
    'ch_alloc',
    'ch_free',
    'ch_parse',
    'ch_result_data',
    'ch_result_size',
] as const satisfies readonly (keyof ParserExports)[];

function isParserExports(value: WebAssembly.Exports): value is WebAssembly.Exports & ParserExports {
    return (
        value.memory instanceof WebAssembly.Memory &&
        requiredParserFunctions.every(name => typeof value[name] === 'function') &&
        (value._initialize === undefined || typeof value._initialize === 'function') &&
        (value.ch_format === undefined || typeof value.ch_format === 'function')
    );
}

async function instantiate(bytes: Uint8Array): Promise<ParserExports> {
    let memory: WebAssembly.Memory | undefined;
    const view = () => {
        if (!memory) throw new Error('WASI memory is not initialized');
        return new DataView(memory.buffer);
    };
    const u32 = (ptr: number, value: number) => view().setUint32(ptr, value, true);
    const u64 = (ptr: number, value: number | bigint) =>
        view().setBigUint64(ptr, BigInt(value), true);
    const success = () => ERRNO_SUCCESS;
    const notSupported = () => ERRNO_NOSYS;
    const preview1: Record<string, CallableFunction> = {
        args_get: success,
        args_sizes_get: (argc: number, size: number) => {
            u32(argc, 0);
            u32(size, 0);
            return ERRNO_SUCCESS;
        },
        environ_get: success,
        environ_sizes_get: (count: number, size: number) => {
            u32(count, 0);
            u32(size, 0);
            return ERRNO_SUCCESS;
        },
        clock_res_get: (_id: number, resolution: number) => {
            u64(resolution, 1000);
            return ERRNO_SUCCESS;
        },
        clock_time_get: (_id: number, _precision: bigint, time: number) => {
            u64(time, BigInt(Date.now()) * 1000000n);
            return ERRNO_SUCCESS;
        },
        fd_advise: success,
        fd_close: success,
        fd_datasync: success,
        fd_fdstat_get: (fd: number, stat: number) => {
            const data = view();
            data.setUint8(stat, fd < 3 ? 2 : 3);
            data.setUint16(stat + 2, 0, true);
            u64(stat + 8, 0);
            u64(stat + 16, 0);
            return ERRNO_SUCCESS;
        },
        fd_fdstat_set_flags: success,
        fd_prestat_get: () => ERRNO_BADF,
        fd_prestat_dir_name: () => ERRNO_BADF,
        fd_seek: (_fd: number, _offset: bigint, _whence: number, newOffset: number) => {
            u64(newOffset, 0);
            return ERRNO_SUCCESS;
        },
        fd_sync: success,
        fd_tell: (_fd: number, offset: number) => {
            u64(offset, 0);
            return ERRNO_SUCCESS;
        },
        fd_write: (_fd: number, iovs: number, count: number, written: number) => {
            const data = view();
            let total = 0;
            for (let i = 0; i < count; i++) total += data.getUint32(iovs + i * 8 + 4, true);
            u32(written, total);
            return ERRNO_SUCCESS;
        },
        proc_exit: (code: number) => {
            throw new Error(`WASI proc_exit(${code})`);
        },
        random_get: (ptr: number, size: number) => {
            if (!memory) return ERRNO_NOSYS;
            crypto.getRandomValues(new Uint8Array(memory.buffer, ptr, size));
            return ERRNO_SUCCESS;
        },
        sched_yield: success,
    };

    const source = new Uint8Array(bytes).buffer;
    const module = await WebAssembly.compile(source);
    for (const imported of WebAssembly.Module.imports(module)) {
        if (imported.module !== 'wasi_snapshot_preview1' || imported.kind !== 'function')
            throw new Error(`Unsupported WebAssembly import: ${imported.module}.${imported.name}`);
        preview1[imported.name] ??= notSupported;
    }
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: preview1 });
    const exports = instance.exports;
    if (!isParserExports(exports)) throw new Error('ClickHouse parser exports are incomplete');
    memory = exports.memory;
    exports._initialize?.();
    return exports;
}

function createParser(exports: ParserExports) {
    const call = (entry: (ptr: number, size: number) => number, input: string) => {
        const bytes = encoder.encode(input),
            ptr = exports.ch_alloc(bytes.length);
        if (!ptr && bytes.length) throw new Error('ClickHouse parser allocation failed');
        new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
        try {
            const ok = entry(ptr, bytes.length);
            const out = decoder.decode(
                new Uint8Array(
                    exports.memory.buffer,
                    exports.ch_result_data(),
                    exports.ch_result_size(),
                ).slice(),
            );
            return { ok: Boolean(ok), out };
        } finally {
            exports.ch_free(ptr);
        }
    };
    return {
        parse(sql: string): NativeParseResult {
            const result = call(exports.ch_parse, sql);
            let envelope: unknown;
            try {
                envelope = JSON.parse(result.out);
            } catch (error) {
                return {
                    error: {
                        message:
                            result.out ||
                            message(error) ||
                            'ClickHouse parser returned invalid diagnostics',
                    },
                };
            }
            try {
                return parseNativeParseResult(envelope);
            } catch (error) {
                return {
                    error: {
                        message: message(error) || 'ClickHouse parser returned invalid diagnostics',
                    },
                };
            }
        },
        format(sql: string): NativeFormatResult {
            const format = exports.ch_format;
            if (typeof format !== 'function')
                return {
                    error: { message: 'Formatting is unavailable in this ClickHouse parser build' },
                };
            const result = call((ptr, size) => format(ptr, size, 0), sql);
            return result.ok ? { sql: result.out } : { error: { message: result.out } };
        },
    };
}

let parserPromise: ReturnType<typeof initialize> | undefined;

async function initialize() {
    try {
        const artifactUrl =
            import.meta.env.VITE_DEMO_MODE === 'true'
                ? '/assets/clickhouse-parser.wasm'
                : '/api/editor/clickhouse-parser.wasm';
        const response = await fetch(artifactUrl);
        if (!response.ok)
            throw new Error(`ClickHouse parser artifact returned HTTP ${response.status}`);
        const parser = createParser(
            await instantiate(new Uint8Array(await response.arrayBuffer())),
        );
        worker.postMessage({ kind: 'status', status: 'ready' });
        return parser;
    } catch (error) {
        const reason = message(error);
        worker.postMessage({ kind: 'status', status: 'unavailable', reason });
        throw error;
    }
}

function parser() {
    parserPromise ??= initialize();
    return parserPromise;
}

worker.addEventListener('message', event => {
    void (async () => {
        const request = event.data;
        try {
            const runtime = await parser();
            if (request.kind === 'parseMany') {
                worker.postMessage({
                    id: request.id,
                    kind: 'parseMany',
                    ok: true,
                    results: request.sql.map(sql => runtime.parse(sql)),
                });
            } else {
                worker.postMessage({
                    id: request.id,
                    kind: 'formatMany',
                    ok: true,
                    results: request.sql.map(sql => runtime.format(sql)),
                });
            }
        } catch (error) {
            worker.postMessage({
                id: request.id,
                kind: request.kind,
                ok: false,
                message: message(error),
            });
        }
    })();
});

// Warm the parser in the worker so the editor can advertise native support before the first edit.
void parser().catch(() => undefined);
