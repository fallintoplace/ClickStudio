import { ASSISTANT_ACTIONS, PROPOSAL_DECISION_ACTIONS } from '../../../shared/assistant/actions.js';
import { MAX_SQL_CHARS } from '../../../shared/queries/execution/limits.js';
import { CLICKHOUSE_CLOUD_CONNECTION_ID } from '../../../shared/database/connections/cloud-policy.js';
import express, { type Express } from 'express';
import type { Principal } from '../../../shared/common/identity.js';
import type { Result } from '../../../shared/queries/results/types.js';
import type { Run } from '../../../shared/queries/execution/types.js';
import type { Schema } from '../../../shared/database/schema/types.js';
import { RunService } from '../../queries/execution/runs.js';
import { AssistantService, validateAssistantConversation } from './assistant.js';
import {
    assistantRequestFrom,
    assistantResultFrom,
    assistantSchemaFrom,
} from '../context/input.js';
import { type Store } from '../../system/storage/store.js';
import { AppError, requireThat } from '../../system/requests/errors.js';
import { canWrite } from '../../system/login/permissions.js';
import { choice, identifier, text } from '../../system/requests/validation.js';
import { selectAssistantReferenceDocs } from '../../../shared/database/reference/catalog.js';
import { type Config } from '../../system/settings/config.js';
import { safetyIdentifier, type VoiceService } from '../voice/voice.js';
import type { Driver } from '../../app/types.js';
import { principal, body, id } from '../../system/requests/http.js';
import { assistantReferenceDocs } from '../context/reference.js';
import type { createSecretGuards } from '../../system/requests/secrets.js';
import { assistantConnectionAuthorized } from '../context/authorization.js';

function registerAssistantSqlRoute(
    app: Express,
    dependencies: {
        config: Config;
        driver: Driver;
        runs: RunService;
        ai: AssistantService;
        store: Store;
        authorized: (principal: Principal, connectionId: string) => boolean;
        secretFree: (value: unknown) => boolean;
    },
) {
    const { config, driver, runs, ai, store, authorized, secretFree } = dependencies;
    app.post('/api/assistant/sql', async (req, res) => {
        const cancellation = new AbortController();
        let preparedContextId: string | undefined;
        let proposalStarted = false;
        const cancelOnDisconnect = () => {
            if (!res.writableEnded && !cancellation.signal.aborted) cancellation.abort();
        };
        req.once('aborted', cancelOnDisconnect);
        res.once('close', cancelOnDisconnect);
        try {
            const p = principal(res),
                v = body(req),
                connectionId = identifier(v.connectionId, 'connectionId');
            canWrite(p);
            requireThat(
                authorized(p, connectionId),
                403,
                'WORKSPACE_UNTRUSTED',
                'Trust this connection before sharing context',
            );
            const browserCloud = connectionId === CLICKHOUSE_CLOUD_CONNECTION_ID;
            if (browserCloud)
                requireThat(
                    Buffer.byteLength(JSON.stringify(v)) <= 300_000,
                    413,
                    'REQUEST_SIZE',
                    'The assistant request is too large.',
                );
            const question = text(v.question, 'question', 4000),
                sql = text(v.sql, 'SQL', MAX_SQL_CHARS, true);
            const conversation = validateAssistantConversation(v.conversation);
            const { action, repair } = assistantRequestFrom(v.action, v.repair);
            const schema = browserCloud
                ? assistantSchemaFrom(v.schema, connectionId)
                : await driver.schema(connectionId);
            const reportedServerVersion =
                typeof v.serverVersion === 'string' &&
                /^\d+(?:\.\d+){2,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(v.serverVersion)
                    ? v.serverVersion
                    : undefined;
            let database: string, serverVersion: string | undefined;
            if (browserCloud) {
                database = text(v.database, 'database', 128);
                serverVersion = reportedServerVersion;
            } else {
                const connection = driver.connection(p, connectionId);
                database = connection.database;
                serverVersion =
                    connection.manifest?.serverVersion === 'ClickHouse SQL Playground'
                        ? reportedServerVersion
                        : connection.manifest?.serverVersion;
            }
            const selectedRunEvidence = () => {
                let run: Run | undefined;
                let result: Result | undefined;
                let evidenceSql: string | undefined;
                let errorMessage: string | undefined;
                if (v.includeRun === true && !repair) {
                    requireThat(
                        Boolean(v.runId),
                        400,
                        'RUN_REQUIRED',
                        'Select a completed run before including its context',
                    );
                    const runId = identifier(v.runId, 'runId');
                    if (browserCloud) {
                        result = assistantResultFrom(v.result);
                        requireThat(
                            !result || result.runId === runId,
                            409,
                            'CONNECTION_MISMATCH',
                            'Selected result belongs to another run',
                        );
                        evidenceSql =
                            v.evidenceSql === undefined
                                ? undefined
                                : text(v.evidenceSql, 'Selected run SQL', MAX_SQL_CHARS, true);
                        errorMessage =
                            v.error === undefined
                                ? undefined
                                : text(v.error, 'Selected run error', 3000, true);
                    } else {
                        run = runs.get(p, runId);
                        requireThat(
                            run.connectionId === connectionId,
                            409,
                            'CONNECTION_MISMATCH',
                            'Selected evidence belongs to another connection',
                        );
                        result =
                            run.resultState === 'reopenable' ? runs.result(p, run.id) : undefined;
                        evidenceSql = run.sql;
                        errorMessage = run.error?.message;
                    }
                }
                return { result, evidenceSql, errorMessage };
            };
            const { result, evidenceSql, errorMessage } = selectedRunEvidence();
            const documentation = browserCloud
                ? selectAssistantReferenceDocs(question, sql, { schema, database })
                : await assistantReferenceDocs(
                      driver,
                      p,
                      connectionId,
                      question,
                      sql,
                      schema,
                      database,
                  );
            const context = ai.prepare(p, {
                connectionId,
                database,
                action,
                question,
                conversation,
                sql,
                schema,
                result,
                evidenceSql: repair?.sql ?? evidenceSql,
                error: repair?.error ?? errorMessage,
                serverVersion,
                documentation,
                sensitiveColumns: config.sensitiveColumns,
            });
            preparedContextId = context.id;
            if (!secretFree(context.payload)) {
                store.delete('ai-contexts', context.id);
                throw new AppError(
                    400,
                    'SECRET_IN_CONTEXT',
                    'This context contains a configured secret; remove it before sharing',
                );
            }
            cancellation.signal.throwIfAborted();
            proposalStarted = true;
            const proposal = await ai.propose(p, context.id, true, cancellation.signal);
            cancellation.signal.throwIfAborted();
            res.status(201).json(proposal);
        } catch (error) {
            if (cancellation.signal.aborted) {
                if (!proposalStarted && preparedContextId)
                    store.delete('ai-contexts', preparedContextId);
            } else throw error;
        } finally {
            req.off('aborted', cancelOnDisconnect);
            res.off('close', cancelOnDisconnect);
        }
    });
}

export function registerAssistantRoutes({
    app,
    ai,
    voice,
    authorized,
    secretFree,
    driver,
    runs,
    config,
    store,
}: {
    app: ReturnType<typeof express>;
    ai: AssistantService;
    voice: VoiceService;
    authorized: (p: Principal, c: string) => boolean;
    secretFree: ReturnType<typeof createSecretGuards>['secretFree'];
    driver: Driver;
    runs: RunService;
    config: Config;
    store: Store;
}) {
    app.get('/api/assistant/status', (_req, res) => res.json(ai.status(principal(res))));
    app.get('/api/assistant/evaluation', (_req, res) => res.json(ai.evaluation(principal(res))));
    app.get('/api/voice/status', (_req, res) =>
        res.json({
            available: voice.available,
            model: voice.model,
            reason: voice.available
                ? undefined
                : 'Set OPENAI_API_KEY on the server to use voice workflows',
        }),
    );
    app.post('/api/voice/session', async (req, res) => {
        const p = principal(res),
            v = body(req),
            connectionId = identifier(v.connectionId, 'connectionId');
        canWrite(p);
        requireThat(
            authorized(p, connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before starting a voice workflow',
        );
        requireThat(
            voice.available,
            503,
            'AI_VOICE_UNAVAILABLE',
            'Set OPENAI_API_KEY on the server to use voice workflows',
        );
        const sdp = text(v.sdp, 'SDP offer', 300000),
            context =
                v.context === undefined
                    ? undefined
                    : text(v.context, 'voice context', 100000, true);
        if (!secretFree({ context }))
            throw new AppError(
                400,
                'SECRET_IN_VOICE_CONTEXT',
                'This voice context contains a configured secret; remove it before starting voice',
            );
        res.status(201).json(
            await voice.createSession({ sdp, context, safetyIdentifier: safetyIdentifier(p.id) }),
        );
    });
    app.post('/api/assistant/context', async (req, res) => {
        const p = principal(res),
            v = body(req),
            connectionId = identifier(v.connectionId, 'connectionId');
        canWrite(p);
        requireThat(
            authorized(p, connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before sharing context',
        );
        const action = choice(
                v.action,
                ASSISTANT_ACTIONS,
                400,
                'ASSISTANT_ACTION',
                'Unknown assistant action',
            ),
            sql = text(v.sql, 'SQL', MAX_SQL_CHARS, true),
            question = text(v.question, 'question', 4000, true),
            schema: Schema = await driver.schema(connectionId);
        const connection = driver.connection(p, connectionId),
            documentation = await assistantReferenceDocs(
                driver,
                p,
                connectionId,
                question,
                sql,
                schema,
                connection.database,
            );
        let run: Run | undefined;
        if (v.runId) {
            run = runs.get(p, identifier(v.runId, 'runId'));
            requireThat(
                run.connectionId === connectionId,
                409,
                'CONNECTION_MISMATCH',
                'Selected evidence belongs to another connection',
            );
        }
        const result = v.includeResult === true && run ? runs.result(p, run.id) : undefined;
        const context = ai.prepare(p, {
            connectionId,
            database: connection.database,
            action,
            question,
            sql,
            schema,
            result,
            evidenceSql: run?.sql,
            error: run?.error?.message,
            serverVersion: connection.manifest?.serverVersion,
            rules: v.rules === undefined ? undefined : text(v.rules, 'workspace rules', 4000, true),
            documentation,
            sensitiveColumns: config.sensitiveColumns,
            image: v.image === undefined ? undefined : text(v.image, 'image', 2900000),
        });
        if (!secretFree(context.payload)) {
            store.delete('ai-contexts', context.id);
            throw new AppError(
                400,
                'SECRET_IN_CONTEXT',
                'This context contains a configured secret; remove it before sharing',
            );
        }
        res.status(201).json({ ...context, evidenceSql: run?.sql ?? null });
    });
    registerAssistantSqlRoute(app, {
        config,
        driver,
        runs,
        ai,
        store,
        authorized: (p, c) => assistantConnectionAuthorized(authorized, p, c),
        secretFree,
    });
    app.post('/api/assistant/proposals', async (req, res) => {
        const v = body(req);
        res.json(
            await ai.propose(
                principal(res),
                identifier(v.contextId, 'contextId'),
                v.consent === true,
            ),
        );
    });
    app.get('/api/assistant/proposals/:id', (req, res) =>
        res.json(ai.get(principal(res), id(req))),
    );
    app.post('/api/assistant/proposals/:id/decision', (req, res) => {
        const v = body(req);
        const decision = choice(
            v.decision,
            PROPOSAL_DECISION_ACTIONS,
            400,
            'DECISION',
            'Unknown proposal decision',
        );
        res.json(
            ai.decide(
                principal(res),
                id(req),
                decision,
                identifier(v.connectionId, 'connectionId'),
                text(v.currentSql, 'current SQL', MAX_SQL_CHARS, true),
            ),
        );
    });
    app.delete('/api/assistant/proposals/:id', (req, res) => {
        ai.remove(principal(res), id(req));
        res.json({ ok: true });
    });
}
