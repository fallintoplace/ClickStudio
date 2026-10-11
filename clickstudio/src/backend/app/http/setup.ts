import { MAX_IMPORT_SOURCE_CHARS } from '../../../shared/database/imports/limits.js';
import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { RunService } from '../../queries/execution/runs.js';
import { ArtifactService } from '../../queries/saved-queries/documents.js';
import { SessionService } from '../../system/login/sessions.js';
import {
    CLOUD_SESSION_COOKIE,
    CloudConnectionSessions,
} from '../../database/connections/cloud-sessions.js';
import { AppError } from '../../system/requests/errors.js';
import { text } from '../../system/requests/validation.js';
import { type Config } from '../../system/settings/config.js';
import { telemetry } from '../../system/logging/telemetry.js';
import { body } from '../../system/requests/http.js';
import { cloudSessionCookieOptions } from '../../database/connections/cookies.js';

const MAX_WASM_PARSER_BYTES = 64 * 1024 * 1024;

let parserWasmCache: Promise<Uint8Array> | undefined;

async function loadClickHouseParserWasm(): Promise<Uint8Array> {
    let bytes: Buffer;
    try {
        bytes = await readFile(
            new URL('../../../../vendor/clickhouse-parser/parser.wasm', import.meta.url),
        );
    } catch {
        throw new AppError(
            503,
            'PARSER_UNAVAILABLE',
            'The bundled ClickHouse native parser is unavailable',
        );
    }
    if (
        bytes.length < 8 ||
        bytes.length > MAX_WASM_PARSER_BYTES ||
        !bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))
    )
        throw new AppError(
            503,
            'PARSER_UNAVAILABLE',
            'The bundled ClickHouse native parser is invalid',
        );
    return bytes;
}

export function cachedClickHouseParserWasm(): Promise<Uint8Array> {
    parserWasmCache ??= loadClickHouseParserWasm().catch(error => {
        parserWasmCache = undefined;
        throw error;
    });
    return parserWasmCache;
}

export function configureHttp(
    app: Express,
    config: Config,
    runs: RunService,
    artifacts: ArtifactService,
    sessions: SessionService,
    cloudSessions: CloudConnectionSessions,
    parserWasm: () => Promise<Uint8Array>,
) {
    app.disable('x-powered-by');
    app.set('trust proxy', false);
    app.use((req, res, next) => {
        res.locals.requestId = randomUUID();
        res.setHeader('X-Request-Id', res.locals.requestId);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws://localhost:5173 ws://127.0.0.1:5173; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        );
        if (req.path.startsWith('/api')) {
            res.setHeader('Cache-Control', 'no-store');
            if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
                if (req.get('x-clickstudio-intent') !== '1') {
                    res.status(403).json({
                        error: {
                            code: 'REQUEST_INTENT',
                            message: 'The workspace action header is required',
                        },
                    });
                    return;
                }
            }
        }
        next();
    });
    app.post('/api/imports/preview', express.json({ limit: MAX_IMPORT_SOURCE_CHARS * 6 + 1024 }));
    app.use(express.json({ limit: '3mb' }));
    app.use('/api', telemetry);
    app.get('/api/health', (_req, res) =>
        res
            .status(runs.acceptingRuns ? 200 : 503)
            .json({ ok: runs.acceptingRuns, demo: config.demo, version: '0.1.0' }),
    );
    app.get('/api/session', (req, res) =>
        res.json({
            principal: sessions.principal(req.get('cookie')) ?? null,
            requiresLogin: sessions.requiresLogin,
            demo: config.demo,
            storageMode: 'single-owner local-first',
            cloudConnectionPersistence: 'local-server',
        }),
    );
    app.post('/api/session', (req, res) => {
        const token = sessions.login(body(req).token, req.socket.remoteAddress ?? 'unknown');
        res.cookie('clickstudio_session', token, {
            httpOnly: true,
            sameSite: 'strict',
            secure: config.origin.startsWith('https:'),
            path: '/',
            maxAge: 12 * 3600000,
        });
        res.json({ ok: true });
    });
    app.delete('/api/session', (req, res) => {
        sessions.logout(req.get('cookie'));
        cloudSessions.revoke(req.get('cookie'));
        res.clearCookie('clickstudio_session', {
            path: '/',
            sameSite: 'strict',
            secure: config.origin.startsWith('https:'),
        });
        res.clearCookie(CLOUD_SESSION_COOKIE, cloudSessionCookieOptions(config));
        res.json({ ok: true });
    });
    app.get('/api/shared/:token', (req, res) =>
        res.json(artifacts.resolveShare(text(req.params.token, 'share token', 100))),
    );
    app.use('/api', (req, res, next) => {
        const p = sessions.principal(req.get('cookie'));
        if (!p) {
            res.status(401).json({
                error: { code: 'LOGIN_REQUIRED', message: 'Sign in to this workspace' },
            });
            return;
        }
        res.locals.principal = p;
        next();
    });
    app.get('/api/editor/clickhouse-parser.wasm', async (_req, res, next) => {
        try {
            const bytes = await parserWasm();
            res.setHeader('Content-Type', 'application/wasm');
            res.setHeader('Cache-Control', 'private, max-age=3600');
            res.send(Buffer.from(bytes));
        } catch (error) {
            next(error);
        }
    });
}
