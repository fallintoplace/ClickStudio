import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { collectCompactStream } from '../../.core-build/core/compact-stream.js';
import { SessionService } from '../../.core-build/core/sessions.js';
import { DEFAULT_LIMITS } from '../../.core-build/shared/types.js';
import { FileStore, MemoryStore, audit } from '../../.core-build/core/store.js';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const header = '["id","text"]\n["UInt64","String"]\n';
test('Compact streaming preserves large integer strings and UTF-8 across byte boundaries', async () => {
    const buffer = Buffer.from(header + '["18446744073709551615","árvíztűrő"]\n');
    const output = await collectCompactStream(
        Readable.from([...buffer].map(n => Buffer.from([n]))),
        DEFAULT_LIMITS,
    );
    assert.equal(output.rows[0][0], '18446744073709551615');
    assert.equal(output.rows[0][1], 'árvíztűrő');
    assert.equal(output.truncated, false);
});
test('Streaming distinguishes exactly-at-limit complete results', async () => {
    const output = await collectCompactStream(Readable.from([header + '["1","a"]\n']), {
        ...DEFAULT_LIMITS,
        rows: 1,
    });
    assert.equal(output.truncated, false);
    assert.equal(output.rows.length, 1);
});
test('Cloud LIMIT results with three or five rows stay complete', async () => {
    for (const count of [3, 5]) {
        const result =
            header +
            Array.from(
                { length: count },
                (_, index) => `["${index + 1}","row-${index + 1}"]\n`,
            ).join('');
        const output = await collectCompactStream(Readable.from([result]), {
            rows: 1_000,
            bytes: 2_000_000,
        });
        assert.equal(output.rows.length, count);
        assert.equal(output.truncated, false);
    }
});
test('Cloud results below the display caps stay complete', async () => {
    const result =
        header +
        Array.from({ length: 34 }, (_, index) => `["${index + 1}","row-${index + 1}"]\n`).join('');
    const output = await collectCompactStream(Readable.from([result]), {
        rows: 1_000,
        bytes: 2_000_000,
    });
    assert.equal(output.rows.length, 34);
    assert.equal(output.truncated, false);
});
test('Cloud result caps retain the row prefix and flag an extra row', async () => {
    const result =
        header +
        Array.from({ length: 1_001 }, (_, index) => `["${index + 1}","row-${index + 1}"]\n`).join(
            '',
        );
    const output = await collectCompactStream(Readable.from([result]), {
        rows: 1_000,
        bytes: 2_000_000,
    });
    assert.equal(output.rows.length, 1_000);
    assert.equal(output.rows[999]?.[0], '1000');
    assert.equal(output.truncated, true);
});
test('Cloud results at the byte cap are complete until another row arrives', async () => {
    const firstRow = '["1","one"]\n',
        secondRow = '["2","two"]\n';
    const cap = Buffer.byteLength(header + firstRow);
    const complete = await collectCompactStream(Readable.from([header + firstRow]), {
        rows: 10,
        bytes: cap,
    });
    const bounded = await collectCompactStream(Readable.from([header + firstRow + secondRow]), {
        rows: 10,
        bytes: cap,
    });
    assert.equal(complete.truncated, false);
    assert.equal(complete.rows.length, 1);
    assert.equal(bounded.truncated, true);
    assert.deepEqual(bounded.rows, [['1', 'one']]);
});
test('Streaming closes the source after observing an extra row', async () => {
    let closed = false;
    async function* source() {
        try {
            yield Buffer.from(header + '["1","a"]\n["2","b"]\n');
            yield Buffer.alloc(1e6);
        } finally {
            closed = true;
        }
    }
    const output = await collectCompactStream(source(), { ...DEFAULT_LIMITS, rows: 1 });
    assert.equal(output.truncated, true);
    assert.equal(output.rows.length, 1);
    assert.equal(closed, true);
});
test('Oversized unterminated rows are bounded before JSON.parse', async () => {
    const output = await collectCompactStream(
        Readable.from([header, '["1","' + 'x'.repeat(1000)]),
        { ...DEFAULT_LIMITS, bytes: 200 },
    );
    assert.equal(output.truncated, true);
    assert.equal(output.rows.length, 0);
});
test('Invalid names/types headers are rejected', async () => {
    await assert.rejects(
        collectCompactStream(Readable.from(['["n"]\n["UInt64","String"]\n']), DEFAULT_LIMITS),
        { code: 'RESULT_METADATA' },
    );
});
test('A broken ClickHouse stream cannot become a successful empty answer', async () => {
    await assert.rejects(
        collectCompactStream(
            Readable.from([header, 'Code: 123. DB::Exception: interrupted']),
            DEFAULT_LIMITS,
        ),
        { code: 'RESULT_STREAM_ERROR' },
    );
});
test('Repeated column names remain separate positional columns', async () => {
    const output = await collectCompactStream(
        Readable.from(['["n","n"]\n["UInt64","UInt64"]\n["1","2"]\n']),
        DEFAULT_LIMITS,
    );
    assert.deepEqual(output.rows, [['1', '2']]);
    assert.equal(output.columns[1].name, 'n');
});
test('Header-only output is a valid empty result', async () => {
    const output = await collectCompactStream(Readable.from([header]), DEFAULT_LIMITS);
    assert.equal(output.rows.length, 0);
    assert.equal(output.truncated, false);
});
test('Local-only sessions are explicit single-owner identities', () =>
    assert.equal(new SessionService().principal().id, 'local-owner'));
test('Configured sessions require authentication and use random cookies', () => {
    const sessions = new SessionService('s'.repeat(40));
    assert.equal(sessions.principal(), undefined);
    const a = sessions.login('s'.repeat(40), 'local'),
        b = sessions.login('s'.repeat(40), 'local');
    assert.notEqual(a, b);
    assert.equal(sessions.principal(`other=x; clickstudio_session=${a}`).role, 'owner');
});
test('Wrong login token cannot create a session', () => {
    const sessions = new SessionService('s'.repeat(40));
    assert.throws(() => sessions.login('wrong', 'local'), { code: 'INVALID_TOKEN' });
});
test('Login brute-force budget is enforced', () => {
    const sessions = new SessionService('s'.repeat(40));
    for (let i = 0; i < 10; i++) assert.throws(() => sessions.login('wrong', 'local'));
    assert.throws(() => sessions.login('s'.repeat(40), 'local'), { code: 'LOGIN_RATE_LIMIT' });
});
test('Logout immediately invalidates the server-side cookie', () => {
    const sessions = new SessionService('s'.repeat(40)),
        token = sessions.login('s'.repeat(40), 'local'),
        cookie = `clickstudio_session=${token}`;
    sessions.logout(cookie);
    assert.equal(sessions.principal(cookie), undefined);
});
test('File storage is atomic, private, and independent of returned object mutation', () => {
    const path = mkdtempSync(join(tmpdir(), 'clickstudio-'));
    try {
        const store = new FileStore(path);
        store.put('docs', 'one', { v: 1 });
        const read = store.get('docs', 'one');
        read.v = 2;
        assert.equal(store.get('docs', 'one').v, 1);
        assert.equal(statSync(join(path, 'docs', 'one.json')).mode & 0o777, 0o600);
        store.put('docs', 'one', { v: 3 });
        assert.equal(store.list('docs').length, 1);
        assert.equal(store.get('docs', 'one').v, 3);
    } finally {
        rmSync(path, { recursive: true, force: true });
    }
});
test('Store key counts distinguish creates from updates', () => {
    const store = new MemoryStore();
    store.put('docs', 'one', { v: 1 });
    store.put('docs', 'one', { v: 2 });
    store.put('docs', 'two', { v: 3 });
    assert.equal(store.count('docs'), 2);
    assert.deepEqual(store.keys('docs').sort(), ['one', 'two']);
    store.delete('docs', 'one');
    assert.equal(store.count('docs'), 1);
});
test('Audit retention prunes by keys without scanning stored event values', () => {
    const store = new MemoryStore();
    store.list = () => {
        throw new Error('audit pruning must not parse all stored events');
    };
    const principal = { id: 'local-owner', role: 'owner' };
    for (let i = 0; i < 5001; i++) audit(store, principal, 'test', String(i));
    assert.equal(store.count('audit'), 4500);
});
test('Storage keys reject filesystem traversal', () => {
    const path = mkdtempSync(join(tmpdir(), 'clickstudio-'));
    try {
        const store = new FileStore(path);
        assert.throws(() => store.put('../outside', 'x', {}), { code: 'INVALID_STORAGE_KEY' });
        assert.throws(() => store.get('docs', '../../outside'), { code: 'INVALID_STORAGE_KEY' });
    } finally {
        rmSync(path, { recursive: true, force: true });
    }
});
test('Corrupt durable state is surfaced, never silently replaced', () => {
    const path = mkdtempSync(join(tmpdir(), 'clickstudio-'));
    try {
        const store = new FileStore(path);
        store.put('docs', 'one', {});
        writeFileSync(join(path, 'docs', 'one.json'), 'broken');
        assert.throws(() => store.get('docs', 'one'));
    } finally {
        rmSync(path, { recursive: true, force: true });
    }
});
