import { CLOUD_ACTIONS } from '../../../shared/database/connections/cloud-requests.js';
import express, { type Express, type Request, type Response } from 'express';
import { Readable } from 'node:stream';
import cloudApi from './cloud-api.js';
import type { Principal } from '../../../shared/common/identity.js';
import { RunService } from '../../queries/execution/runs.js';
import {
    CLOUD_SESSION_COOKIE,
    CloudConnectionSessions,
    type CloudCredentials,
} from './cloud-sessions.js';
import { requireThat } from '../../system/requests/errors.js';
import { canWrite } from '../../system/login/permissions.js';
import { type Config } from '../../system/settings/config.js';
import { cloudSessionCookieOptions } from './cookies.js';
import { body, principal, id, boolean } from '../../system/requests/http.js';
import type { Driver } from '../../app/types.js';

export function registerCloudApi(
    app: Express,
    config: Config,
    cloudSessions: CloudConnectionSessions,
    cloudApiClient: Pick<typeof cloudApi, 'fetch'>,
) {
    const cloudUrl = (req: Request) =>
        new URL('/api/cloud', `${req.protocol}://${req.get('host') ?? '127.0.0.1'}`);
    const cloudHeaders = (req: Request) => {
        const headers = new Headers();
        const origin = req.get('origin');
        if (origin) headers.set('origin', origin);
        return headers;
    };
    const forward = async (response: globalThis.Response, res: Response) => {
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
    };
    const sameOrigin = (req: Request) => {
        const origin = req.get('origin');
        return !origin || origin === `${req.protocol}://${req.get('host') ?? ''}`;
    };
    app.get('/api/cloud/session', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const snapshot = cloudSessions.snapshot(req.get('cookie'));
        if (!snapshot) res.clearCookie(CLOUD_SESSION_COOKIE, cloudSessionCookieOptions(config));
        res.json({ session: snapshot ?? null });
    });
    app.post('/api/cloud/session', async (req, res, next) => {
        try {
            if (!sameOrigin(req)) {
                res.status(403).json({
                    error: {
                        code: 'ORIGIN',
                        message: 'This endpoint accepts requests from the ClickStudio site only.',
                    },
                });
                return;
            }
            const credentialsValue = body(req).credentials;
            if (
                typeof credentialsValue !== 'object' ||
                credentialsValue === null ||
                Array.isArray(credentialsValue)
            ) {
                res.status(400).json({
                    error: {
                        code: 'CLOUD_CREDENTIALS',
                        message: 'Enter your ClickHouse Cloud connection details.',
                    },
                });
                return;
            }
            const credentials = credentialsValue as Partial<CloudCredentials>;
            if (
                typeof credentials.host !== 'string' ||
                typeof credentials.database !== 'string' ||
                typeof credentials.username !== 'string' ||
                typeof credentials.password !== 'string'
            ) {
                res.status(400).json({
                    error: {
                        code: 'CLOUD_CREDENTIALS',
                        message: 'Check the host, database, username, and password.',
                    },
                });
                return;
            }
            const headers = cloudHeaders(req);
            headers.set('content-type', 'application/json');
            const request = new globalThis.Request(cloudUrl(req), {
                method: 'POST',
                headers,
                body: JSON.stringify({ action: CLOUD_ACTIONS.test, credentials }),
            });
            const response = await cloudApiClient.fetch(request);
            if (!response.ok) {
                await forward(response, res);
                return;
            }
            const tested: unknown = await response.json();
            if (typeof tested !== 'object' || tested === null || Array.isArray(tested)) {
                res.status(502).json({
                    error: {
                        code: 'CLOUD_RESPONSE',
                        message: 'ClickHouse Cloud returned an invalid connection response.',
                    },
                });
                return;
            }
            const test = tested as Record<string, unknown>;
            const savedCredentials: CloudCredentials = {
                host: typeof test.host === 'string' ? test.host : credentials.host,
                database: typeof test.database === 'string' ? test.database : credentials.database,
                username: typeof test.username === 'string' ? test.username : credentials.username,
                password: credentials.password,
            };
            const token = cloudSessions.create(savedCredentials, test, req.get('cookie'));
            res.cookie(CLOUD_SESSION_COOKIE, token, cloudSessionCookieOptions(config));
            res.setHeader('Cache-Control', 'no-store');
            res.json(test);
        } catch (error) {
            next(error);
        }
    });
    app.delete('/api/cloud/session', (req, res) => {
        if (!sameOrigin(req)) {
            res.status(403).json({
                error: {
                    code: 'ORIGIN',
                    message: 'This endpoint accepts requests from the ClickStudio site only.',
                },
            });
            return;
        }
        cloudSessions.revoke(req.get('cookie'));
        res.clearCookie(CLOUD_SESSION_COOKIE, cloudSessionCookieOptions(config));
        res.status(204).end();
    });
    app.post('/api/cloud', async (req, res, next) => {
        try {
            const url = cloudUrl(req);
            const headers = cloudHeaders(req);
            const contentType = req.get('content-type') ?? '';
            const credentials = cloudSessions.credentials(req.get('cookie'));
            let request: globalThis.Request;
            if (contentType.toLowerCase().startsWith('multipart/form-data') && credentials) {
                const incomingHeaders = cloudHeaders(req);
                incomingHeaders.set('content-type', contentType);
                const incomingInit: RequestInit & { duplex?: 'half' } = {
                    method: req.method,
                    headers: incomingHeaders,
                    body: Readable.toWeb(req) as ReadableStream,
                    duplex: 'half',
                };
                const incoming = new globalThis.Request(url, incomingInit);
                const form = await incoming.formData();
                form.set('credentials', JSON.stringify(credentials));
                request = new globalThis.Request(url, { method: req.method, headers, body: form });
            } else if (contentType.toLowerCase().startsWith('multipart/form-data')) {
                headers.set('content-type', contentType);
                const incomingInit: RequestInit & { duplex?: 'half' } = {
                    method: req.method,
                    headers,
                    body: Readable.toWeb(req) as ReadableStream,
                    duplex: 'half',
                };
                request = new globalThis.Request(url, incomingInit);
            } else if (contentType.toLowerCase().startsWith('application/json')) {
                const incoming = body(req);
                const payload = credentials ? { ...incoming, credentials } : incoming;
                headers.set('content-type', 'application/json');
                request = new globalThis.Request(url, {
                    method: req.method,
                    headers,
                    body: JSON.stringify(payload),
                });
            } else {
                if (contentType) headers.set('content-type', contentType);
                request = new globalThis.Request(url, {
                    method: req.method,
                    headers,
                    body:
                        req.method === 'GET' || req.method === 'HEAD'
                            ? undefined
                            : (Readable.toWeb(req) as ReadableStream),
                    ...(req.method === 'GET' || req.method === 'HEAD'
                        ? {}
                        : { duplex: 'half' as const }),
                });
            }
            const response = await cloudApiClient.fetch(request);
            await forward(response, res);
        } catch (error) {
            next(error);
        }
    });
}

export function registerConnectionRoutes({
    app,
    driver,
    runs,
    authorized,
}: {
    app: ReturnType<typeof express>;
    driver: Driver;
    runs: RunService;
    authorized: (p: Principal, c: string) => boolean;
}) {
    app.get('/api/connections', (_req, res) => {
        const p = principal(res);
        res.json(driver.connections(p).map(c => ({ ...c, trusted: runs.isTrusted(p, c.id) })));
    });
    app.post('/api/connections/:id/test', async (req, res) => {
        canWrite(principal(res));
        res.json(await driver.test(id(req)));
    });
    app.post('/api/connections/:id/trust', (req, res) => {
        const p = principal(res),
            v = body(req),
            connectionId = id(req);
        requireThat(
            v.confirmation === connectionId,
            400,
            'TRUST_CONFIRMATION',
            'Confirm the selected connection ID',
        );
        runs.trust(p, connectionId, boolean(v.trusted, 'trusted'));
        res.json({ trusted: runs.isTrusted(p, connectionId) });
    });
    app.get('/api/connections/:id/schema', async (req, res) => {
        const p = principal(res),
            c = id(req);
        requireThat(
            authorized(p, c),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting its schema',
        );
        res.json(await driver.schema(c));
    });
}
