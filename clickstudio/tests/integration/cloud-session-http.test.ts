import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { CLOUD_SESSION_COOKIE } from '../../server/cloud-sessions.js';
import { MemoryStore } from '../../core/store.js';
import { DemoDriver } from '../../server/demo.js';

const credentials = { host: 'service.region.provider.clickhouse.cloud:8443', database: 'default', username: 'default', password: 'local-cloud-secret' };
const tested = { host: credentials.host, database: credentials.database, username: credentials.username, serverVersion: '25.1.1', queryLog: { available: true } };
type CloudCall = { action: string; credentials?: typeof credentials };

async function start() {
    const cloudCalls: CloudCall[] = [];
    const cloudApi = {
        fetch: async (request: Request) => {
            const contentType = request.headers.get('content-type') ?? '';
            if (contentType.startsWith('multipart/form-data')) {
                const form = await request.formData();
                const value = form.get('credentials');
                const saved = typeof value === 'string' ? JSON.parse(value) as typeof credentials : undefined;
                cloudCalls.push({ action: String(form.get('action') ?? ''), credentials: saved });
                return Response.json({ accepted: true });
            }
            const body = await request.json() as Record<string, unknown>;
            const action = typeof body.action === 'string' ? body.action : '';
            const requestCredentials = typeof body.credentials === 'object' && body.credentials !== null ? body.credentials as typeof credentials : undefined;
            cloudCalls.push({ action, credentials: requestCredentials });
            if (action === 'test') {
                if (requestCredentials?.password === 'bad-password')
                    return Response.json({ error: { code: 'CLICKHOUSE_PERMISSION', message: 'Credentials were rejected.' } }, { status: 403 });
                return Response.json({ ...tested, host: requestCredentials?.host ?? tested.host });
            }
            if (!requestCredentials)
                return Response.json({ error: { code: 'CLOUD_CREDENTIALS', message: 'Missing credentials.' } }, { status: 400 });
            return Response.json({ action, credentials: requestCredentials });
        },
    };
    const config = loadConfig({ DEMO_MODE: 'true' });
    const service = createApp(config, { store: new MemoryStore(), driver: new DemoDriver(), cloudApi });
    const server = service.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    config.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = (path: string, body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? 'GET' : 'POST') => fetch(`${config.origin}/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-clickstudio-intent': '1', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
        call,
        cloudCalls,
        origin: config.origin,
        stop: async () => {
            await service.close();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        },
    };
}

function cookieFrom(response: Response) {
    return response.headers.get('set-cookie')?.split(';', 1)[0];
}

test('Local Cloud connection restores after refresh without returning its password', async (t) => {
    const app = await start();
    t.after(() => app.stop());
    const connected = await app.call('/cloud/session', { credentials });
    assert.equal(connected.status, 200);
    const setCookie = connected.headers.get('set-cookie') ?? '';
    const cookie = cookieFrom(connected);
    assert.ok(cookie?.startsWith(`${CLOUD_SESSION_COOKIE}=`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/api;/i);
    assert.equal(/Max-Age=/i.test(setCookie), false);

    const refreshed = await app.call('/cloud/session', undefined, { cookie: cookie! });
    const snapshot = await refreshed.json() as { session: { profile: Record<string, unknown>; tested: Record<string, unknown> } | null };
    assert.equal(refreshed.status, 200);
    assert.equal(snapshot.session?.profile.host, tested.host);
    assert.equal(JSON.stringify(snapshot).includes(credentials.password), false);

    const schema = await app.call('/cloud', { action: 'schema' }, { cookie: cookie! });
    assert.equal(schema.status, 200);
    assert.equal(app.cloudCalls.at(-1)?.credentials?.password, credentials.password);
});

test('Local Cloud restore skips a stale duplicate cookie before the active session', async (t) => {
    const app = await start();
    t.after(() => app.stop());
    const secondCredentials = { ...credentials, host: 'other.region.provider.clickhouse.cloud:8443' };
    const connected = await app.call('/cloud/session', { credentials: secondCredentials });
    const activeCookie = cookieFrom(connected)!;
    const staleCookie = `${CLOUD_SESSION_COOKIE}=${'A'.repeat(43)}`;

    const refreshed = await app.call('/cloud/session', undefined, { cookie: `${staleCookie}; ${activeCookie}` });
    const snapshot = await refreshed.json() as { session: { profile: Record<string, unknown> } | null };
    assert.equal(refreshed.status, 200);
    assert.equal(snapshot.session?.profile.host, secondCredentials.host);
});

test('Disconnect revokes every active session in a duplicate cookie', async (t) => {
    const app = await start();
    t.after(() => app.stop());
    const first = await app.call('/cloud/session', { credentials });
    const second = await app.call('/cloud/session', { credentials: { ...credentials, host: 'other.region.provider.clickhouse.cloud:8443' } });
    const firstCookie = cookieFrom(first)!;
    const secondCookie = cookieFrom(second)!;

    const disconnected = await app.call('/cloud/session', undefined, { cookie: `${firstCookie}; ${secondCookie}` }, 'DELETE');
    assert.equal(disconnected.status, 204);
    assert.deepEqual(await (await app.call('/cloud/session', undefined, { cookie: firstCookie })).json(), { session: null });
    assert.deepEqual(await (await app.call('/cloud/session', undefined, { cookie: secondCookie })).json(), { session: null });
});

test('Disconnect revokes the local Cloud session and expires its cookie', async (t) => {
    const app = await start();
    t.after(() => app.stop());
    const connected = await app.call('/cloud/session', { credentials });
    const cookie = cookieFrom(connected)!;
    const disconnected = await app.call('/cloud/session', undefined, { cookie }, 'DELETE');
    assert.equal(disconnected.status, 204);
    assert.match(disconnected.headers.get('set-cookie') ?? '', /Expires=Thu, 01 Jan 1970/i);

    const refreshed = await app.call('/cloud/session', undefined, { cookie });
    assert.deepEqual(await refreshed.json(), { session: null });
    const schema = await app.call('/cloud', { action: 'schema' }, { cookie });
    assert.equal(schema.status, 400);
    assert.equal(app.cloudCalls.at(-1)?.credentials, undefined);
});

test('Workspace logout revokes the local Cloud session', async (t) => {
    const app = await start();
    t.after(() => app.stop());
    const connected = await app.call('/cloud/session', { credentials });
    const cookie = cookieFrom(connected)!;
    const logout = await app.call('/session', undefined, { cookie }, 'DELETE');
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') ?? '', /clickstudio_cloud_session=; Path=\/api;/i);

    const refreshed = await app.call('/cloud/session', undefined, { cookie });
    assert.deepEqual(await refreshed.json(), { session: null });
    const schema = await app.call('/cloud', { action: 'schema' }, { cookie });
    assert.equal(schema.status, 400);
    assert.equal(app.cloudCalls.at(-1)?.credentials, undefined);
});

test('A replacement Cloud connection invalidates the previous browser cookie only after testing succeeds', async (t) => {
    const app = await start();
    t.after(() => app.stop());
    const first = await app.call('/cloud/session', { credentials });
    const firstCookie = cookieFrom(first)!;
    const rejected = await app.call('/cloud/session', { credentials: { ...credentials, password: 'bad-password' } }, { cookie: firstCookie });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get('set-cookie'), null);
    assert.ok((await (await app.call('/cloud/session', undefined, { cookie: firstCookie })).json() as { session: unknown }).session);

    const secondCredentials = { ...credentials, host: 'other.region.provider.clickhouse.cloud:8443' };
    const second = await app.call('/cloud/session', { credentials: secondCredentials }, { cookie: firstCookie });
    const secondCookie = cookieFrom(second)!;
    assert.notEqual(secondCookie, firstCookie);
    assert.deepEqual(await (await app.call('/cloud/session', undefined, { cookie: firstCookie })).json(), { session: null });
    const restored = await (await app.call('/cloud/session', undefined, { cookie: secondCookie })).json() as { session: { profile: Record<string, unknown> } };
    assert.equal(restored.session.profile.host, secondCredentials.host);
});

test('Replacing a Cloud connection revokes every session in a duplicate cookie', async (t) => {
    const app = await start();
    t.after(() => app.stop());
    const first = await app.call('/cloud/session', { credentials });
    const firstCookie = cookieFrom(first)!;
    const secondCredentials = { ...credentials, host: 'other.region.provider.clickhouse.cloud:8443' };
    const second = await app.call('/cloud/session', { credentials: secondCredentials });
    const secondCookie = cookieFrom(second)!;
    const replacementCredentials = { ...credentials, host: 'third.region.provider.clickhouse.cloud:8443' };

    const replacement = await app.call('/cloud/session', { credentials: replacementCredentials }, { cookie: `${firstCookie}; ${secondCookie}` });
    const replacementCookie = cookieFrom(replacement)!;
    assert.deepEqual(await (await app.call('/cloud/session', undefined, { cookie: `${firstCookie}; ${secondCookie}` })).json(), { session: null });
    const restored = await (await app.call('/cloud/session', undefined, { cookie: replacementCookie })).json() as { session: { profile: Record<string, unknown> } };
    assert.equal(restored.session.profile.host, replacementCredentials.host);
});

test('Local Cloud session creation rejects a cross-origin request before testing credentials', async (t) => {
    const app = await start();
    t.after(() => app.stop());
    const response = await app.call('/cloud/session', { credentials }, { origin: 'https://evil.example' });
    assert.equal(response.status, 403);
    assert.equal(app.cloudCalls.length, 0);
    assert.equal(response.headers.get('set-cookie'), null);
});

test('Cloud file imports use the local server session instead of credentials in the form', async (t) => {
    const app = await start();
    t.after(() => app.stop());
    const connected = await app.call('/cloud/session', { credentials });
    const cookie = cookieFrom(connected)!;
    const form = new FormData();
    form.set('action', 'import-commit');
    form.set('file', new Blob(['id\n1\n'], { type: 'text/csv' }), 'rows.csv');
    const response = await fetch(`${app.origin}/api/cloud`, {
        method: 'POST',
        headers: { 'x-clickstudio-intent': '1', cookie },
        body: form,
    });
    assert.equal(response.status, 200);
    assert.equal(app.cloudCalls.at(-1)?.action, 'import-commit');
    assert.equal(app.cloudCalls.at(-1)?.credentials?.password, credentials.password);
});
