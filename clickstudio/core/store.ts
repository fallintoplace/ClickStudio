import {
    mkdirSync,
    writeFileSync,
    readFileSync,
    renameSync,
    unlinkSync,
    readdirSync,
    openSync,
    closeSync,
    fsyncSync,
    existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { AuditEvent, Principal } from '../shared/types.js';
import { requireThat } from './errors.js';

function errorCode(error: unknown): string | undefined {
    return error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string'
        ? error.code
        : undefined;
}
export interface Store {
    get<T>(bucket: string, id: string): T | undefined;
    put<T>(bucket: string, id: string, value: T): void;
    delete(bucket: string, id: string): void;
    list<T>(bucket: string): T[];
    keys(bucket: string): string[];
    count(bucket: string): number;
}
export class MemoryStore implements Store {
    private data = new Map<string, Map<string, unknown>>();
    get<T>(bucket: string, id: string): T | undefined {
        return structuredClone(this.data.get(bucket)?.get(id)) as T | undefined;
    }
    put<T>(bucket: string, id: string, value: T) {
        if (!this.data.has(bucket)) this.data.set(bucket, new Map());
        this.data.get(bucket)!.set(id, structuredClone(value));
    }
    delete(bucket: string, id: string) {
        this.data.get(bucket)?.delete(id);
    }
    list<T>(bucket: string): T[] {
        return structuredClone([...(this.data.get(bucket)?.values() ?? [])]) as T[];
    }
    keys(bucket: string): string[] {
        return [...(this.data.get(bucket)?.keys() ?? [])];
    }
    count(bucket: string): number {
        return this.data.get(bucket)?.size ?? 0;
    }
}
/** Atomic single-process persistence. Do not share this directory between replicas. */
export class FileStore implements Store {
    private counts = new Map<string, number>();
    constructor(private readonly directory: string) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    private syncDirectory(directory: string) {
        const dirfd = openSync(directory, 'r');
        try {
            fsyncSync(dirfd);
        } finally {
            closeSync(dirfd);
        }
    }
    private path(bucket: string, id?: string) {
        for (const part of [bucket, ...(id === undefined ? [] : [id])]) {
            requireThat(
                /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(part),
                400,
                'INVALID_STORAGE_KEY',
                'Invalid storage key',
            );
        }
        return id === undefined
            ? join(this.directory, bucket)
            : join(this.directory, bucket, `${id}.json`);
    }
    get<T>(bucket: string, id: string): T | undefined {
        try {
            return JSON.parse(readFileSync(this.path(bucket, id), 'utf8')) as T;
        } catch (error) {
            if (errorCode(error) === 'ENOENT') return undefined;
            throw error;
        }
    }
    put<T>(bucket: string, id: string, value: T) {
        const directory = this.path(bucket),
            target = this.path(bucket, id),
            existed = existsSync(target);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const temp = join(directory, `.${randomUUID()}.tmp`);
        const fd = openSync(temp, 'wx', 0o600);
        try {
            try {
                writeFileSync(fd, JSON.stringify(value));
                fsyncSync(fd);
            } finally {
                closeSync(fd);
            }
            renameSync(temp, target);
        } catch (error) {
            if (existsSync(temp)) unlinkSync(temp);
            throw error;
        }
        // Persist the directory entry, not only the temporary file contents.
        this.syncDirectory(directory);
        if (!existed && this.counts.has(bucket))
            this.counts.set(bucket, this.counts.get(bucket)! + 1);
    }
    delete(bucket: string, id: string) {
        const directory = this.path(bucket);
        let removed = false;
        try {
            unlinkSync(this.path(bucket, id));
            removed = true;
        } catch (error) {
            if (errorCode(error) !== 'ENOENT') throw error;
        }
        if (removed) {
            this.syncDirectory(directory);
            if (this.counts.has(bucket))
                this.counts.set(bucket, Math.max(0, this.counts.get(bucket)! - 1));
        }
    }
    keys(bucket: string): string[] {
        let names: string[];
        try {
            names = readdirSync(this.path(bucket));
        } catch (error) {
            if (errorCode(error) === 'ENOENT') return [];
            throw error;
        }
        return names
            .filter(n => /^[A-Za-z0-9][A-Za-z0-9_-]*\.json$/.test(n))
            .map(n => n.slice(0, -5));
    }
    count(bucket: string): number {
        const cached = this.counts.get(bucket);
        if (cached !== undefined) return cached;
        const count = this.keys(bucket).length;
        this.counts.set(bucket, count);
        return count;
    }
    list<T>(bucket: string): T[] {
        return this.keys(bucket)
            .map(id => this.get<T>(bucket, id)!)
            .filter(Boolean);
    }
}
export function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object')
        return (
            '{' +
            Object.entries(value)
                .filter(([, v]) => v !== undefined)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v))
                .join(',') +
            '}'
        );
    return JSON.stringify(value) ?? 'null';
}
export function hash(value: unknown): string {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}
export function audit(
    store: Store,
    principal: Principal,
    action: string,
    resourceId: string,
    outcome: AuditEvent['outcome'] = 'allowed',
    ruleId?: string,
) {
    const event: AuditEvent = {
        id: `t${Date.now().toString(36)}-${randomUUID()}`,
        at: new Date().toISOString(),
        owner: principal.id,
        action,
        resourceId,
        outcome,
        ruleId,
    };
    store.put('audit', event.id, event);
    // Keep the hot path O(1) after the first bucket count. When pruning is needed,
    // filenames are enough: new IDs sort by timestamp and legacy UUIDs age out first.
    if (store.count('audit') > 5000) {
        const order = (id: string) =>
            /^t[0-9a-z]+-[0-9a-f-]{36}$/.test(id) ? `1-${id}` : `0-${id}`;
        const ids = store.keys('audit').sort((a, b) => order(a).localeCompare(order(b)));
        for (const id of ids.slice(0, Math.max(0, ids.length - 4500))) store.delete('audit', id);
    }
}
