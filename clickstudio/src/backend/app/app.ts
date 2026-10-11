import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cloudApi from '../database/connections/cloud-api.js';
import type { Principal } from '../../shared/common/identity.js';
import { RunService } from '../queries/execution/runs.js';
import { ArtifactService } from '../queries/saved-queries/documents.js';
import { AssistantService, type AssistantDriver } from '../assistant/proposals/assistant.js';
import { ImportService } from '../database/imports/imports.js';
import { TableCreationService } from '../database/tables/create-table.js';
import { TableDeletionService } from '../database/tables/delete-table.js';
import { MonitorService } from '../queries/monitoring/monitors.js';
import { SessionService } from '../system/login/sessions.js';
import { CloudConnectionSessions } from '../database/connections/cloud-sessions.js';
import { FileStore, type Store } from '../system/storage/store.js';
import { AppError, asError } from '../system/requests/errors.js';
import { redactor, type Config } from '../system/settings/config.js';
import { ClickHouseDriver } from '../database/clickhouse/client.js';
import { DemoDriver } from '../database/clickhouse/sample-client.js';
import { OpenAIDriver } from '../assistant/openai/client.js';
import { OpenAIVoiceService, type VoiceService } from '../assistant/voice/voice.js';
import { registerMcpRoutes } from './mcp/mcp.js';
import type { Driver } from './types.js';
import { cachedClickHouseParserWasm, configureHttp } from './http/setup.js';
import { registerCloudApi, registerConnectionRoutes } from '../database/connections/routes.js';
import { registerExplorerRoutes } from '../database/explorer/routes.js';
import { registerDocumentationRoutes } from '../database/explorer/reference-routes.js';
import { registerTableRoutes } from '../database/tables/routes.js';
import { registerRunRoutes } from '../queries/execution/routes.js';
import { registerDocumentRoutes } from '../queries/saved-queries/routes.js';
import { registerAssistantRoutes } from '../assistant/proposals/routes.js';
import { registerImportRoutes } from '../database/imports/routes.js';
import { registerMonitorRoutes } from '../queries/monitoring/routes.js';
import { assistantConnectionAuthorized } from '../assistant/context/authorization.js';
import { createSecretGuards } from '../system/requests/secrets.js';

export function createApp(
    config: Config,
    overrides: {
        store?: Store;
        driver?: Driver;
        assistant?: AssistantDriver;
        voice?: VoiceService;
        parserWasm?: () => Promise<Uint8Array>;
        cloudApi?: Pick<typeof cloudApi, 'fetch'>;
    } = {},
) {
    const app = express(),
        store = overrides.store ?? new FileStore(config.dataDir),
        driver: Driver =
            overrides.driver ?? (config.demo ? new DemoDriver() : new ClickHouseDriver(config));
    const runs = new RunService(store, driver, (p, c) => driver.connection(p, c)),
        artifacts = new ArtifactService(store, runs, (p, c) => driver.connection(p, c));
    for (const profile of config.profiles)
        if (profile.publicPlayground)
            runs.trust({ id: 'local-owner', role: 'owner' }, profile.id, true);
    const authorized = (p: Principal, c: string) => {
        driver.connection(p, c);
        return runs.isTrusted(p, c);
    };
    const ai = new AssistantService(
        store,
        overrides.assistant ??
            new OpenAIDriver(config.demo ? undefined : config.openaiKey, config.openaiModel),
        (p, c) => assistantConnectionAuthorized(authorized, p, c),
    );
    const voice =
        overrides.voice ??
        new OpenAIVoiceService(
            config.demo ? undefined : config.openaiKey,
            config.openaiRealtimeModel,
        );
    const imports = new ImportService(store, driver, authorized),
        tableCreation = new TableCreationService(store, driver, authorized),
        tableDeletion = new TableDeletionService(store, driver, authorized),
        monitors = new MonitorService(store, runs, artifacts),
        sessions = new SessionService(config.token),
        cloudSessions = new CloudConnectionSessions(),
        redact = redactor(config),
        parserWasm = overrides.parserWasm ?? cachedClickHouseParserWasm;
    const { secretFree, safeExport } = createSecretGuards(config);
    configureHttp(app, config, runs, artifacts, sessions, cloudSessions, parserWasm);
    const closeMcp = registerMcpRoutes(app, { config, driver, runs, safeExport });
    registerCloudApi(app, config, cloudSessions, overrides.cloudApi ?? cloudApi);
    registerConnectionRoutes({ app, driver, runs, authorized });
    registerExplorerRoutes({ app, authorized, driver });
    registerDocumentationRoutes({ authorized, driver, app });
    registerTableRoutes({ app, tableCreation, tableDeletion, driver });
    registerRunRoutes({ app, runs, store, sessions, safeExport, authorized, driver, config });
    registerDocumentRoutes({ app, driver, artifacts, safeExport });
    registerAssistantRoutes({
        app,
        ai,
        voice,
        authorized,
        secretFree,
        driver,
        runs,
        config,
        store,
    });
    registerImportRoutes({ app, driver, imports });
    registerMonitorRoutes({ app, monitors, store });
    app.use('/api', (_req, res) =>
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found' } }),
    );
    const frontend = resolve('dist/frontend');
    if (existsSync(frontend)) {
        app.use(express.static(frontend, { index: false }));
        app.get('/{*splat}', (_req, res) => res.sendFile(resolve(frontend, 'index.html')));
    }
    const errors: ErrorRequestHandler = (error, _req, res, _next) => {
        if (res.headersSent) {
            res.end();
            return;
        }
        const parsed = asError(error);
        const tooLarge =
            error !== null &&
            typeof error === 'object' &&
            'type' in error &&
            error.type === 'entity.too.large';
        const getErrorStatus = () => {
            if (tooLarge) {
                return 413;
            }

            if (error instanceof AppError) {
                return error.status;
            }

            if (error instanceof SyntaxError) {
                return 400;
            }

            return 500;
        };
        res.status(getErrorStatus()).json({
            error: { ...parsed, message: redact(parsed.message) },
            requestId: res.locals.requestId,
        });
    };
    app.use(errors);
    return {
        app,
        store,
        runs,
        artifacts,
        ai,
        voice,
        imports,
        monitors,
        driver,
        close: async () => {
            await closeMcp();
            await runs.close();
            await driver.close();
        },
    };
}
