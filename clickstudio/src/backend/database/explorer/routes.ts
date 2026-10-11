import { NATIVE_EXPLORER_KINDS } from '../../../shared/database/explorer/explorers.js';
import { MAX_SQL_CHARS } from '../../../shared/queries/execution/limits.js';
import express from 'express';
import type { Principal } from '../../../shared/common/identity.js';
import { requireThat } from '../../system/requests/errors.js';
import { canWrite } from '../../system/login/permissions.js';
import { guardSql } from '../../queries/execution/guards.js';
import { choice, stringMap, text } from '../../system/requests/validation.js';
import {
    WORKLOAD_WINDOWS,
    type WorkloadWindow,
} from '../../../shared/database/explorer/activity/workload.js';
import type { Driver } from '../../app/types.js';
import { id, body, principal } from '../../system/requests/http.js';

export function registerExplorerRoutes({
    app,
    authorized,
    driver,
}: {
    app: ReturnType<typeof express>;
    authorized: (p: Principal, c: string) => boolean;
    driver: Driver;
}) {
    app.post('/api/connections/:id/native-explorer', async (req, res) => {
        const connectionId = id(req),
            value = body(req);
        requireThat(
            authorized(principal(res), connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting native metadata',
        );
        const kind = choice(
            value.kind,
            NATIVE_EXPLORER_KINDS,
            400,
            'INVALID_REQUEST',
            'Unknown native explorer kind',
        );
        const database = text(value.database, 'database', 128);
        const request =
            kind === 'lineage'
                ? { kind, database }
                : { kind, database, table: text(value.table, 'table', 128) };
        const controller = new AbortController();
        const cancel = () => {
            if (!res.writableEnded) controller.abort();
        };
        res.once('close', cancel);
        try {
            res.json(await driver.nativeExplorer(connectionId, request, controller.signal));
        } finally {
            res.off('close', cancel);
        }
    });
    app.get('/api/connections/:id/workload', async (req, res) => {
        const p = principal(res),
            connectionId = id(req);
        requireThat(
            authorized(p, connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting workload history',
        );
        const capability = driver.connection(p, connectionId).manifest?.queryLog;
        requireThat(
            capability?.available === true,
            409,
            'CAPABILITY_UNAVAILABLE',
            capability?.reason ?? 'Query-log visibility is unavailable on this connection',
        );
        requireThat(
            req.query.minutes === undefined || typeof req.query.minutes === 'string',
            400,
            'INVALID_REQUEST',
            'minutes must be a single value',
        );
        const value = choice(
            req.query.minutes ?? '60',
            WORKLOAD_WINDOWS.map(String),
            400,
            'INVALID_REQUEST',
            'minutes must be 15, 60, 360, or 1440',
        );
        res.json(await driver.workload(connectionId, Number(value) as WorkloadWindow));
    });
    app.get('/api/connections/:id/replication', async (req, res) => {
        const p = principal(res),
            connectionId = id(req);
        requireThat(
            authorized(p, connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting replication health',
        );
        const capability = driver.connection(p, connectionId).manifest?.replication;
        requireThat(
            capability?.available === true,
            409,
            'CAPABILITY_UNAVAILABLE',
            capability?.reason ?? 'Replication system tables are unavailable on this connection',
        );
        res.json(await driver.replication(connectionId));
    });
    app.post('/api/connections/:id/table-parts', async (req, res) => {
        const p = principal(res),
            connectionId = id(req),
            value = body(req);
        requireThat(
            authorized(p, connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting table storage',
        );
        const database = text(value.database, 'database', 128),
            table = text(value.table, 'table', 128);
        res.json(await driver.tableParts(connectionId, database, table));
    });
    app.post('/api/connections/:id/query-tree', async (req, res) => {
        const p = principal(res),
            connectionId = id(req),
            value = body(req);
        canWrite(p);
        requireThat(
            authorized(p, connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting its analyzer tree',
        );
        const manifest = driver.connection(p, connectionId).manifest;
        const capability = manifest?.queryTree ?? manifest?.explain;
        requireThat(
            capability?.available !== false,
            409,
            'CAPABILITY_UNAVAILABLE',
            capability?.reason ??
                'ClickHouse query-tree analysis is unavailable for this connection',
        );
        const sql = text(value.sql, 'SQL', MAX_SQL_CHARS),
            parameters = stringMap(value.parameters, 'parameters');
        guardSql(sql, parameters);
        res.json(await driver.queryTree(connectionId, sql, parameters));
    });
}
