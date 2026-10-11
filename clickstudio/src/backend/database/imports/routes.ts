import {
    IMPORT_FORMATS,
    MAX_IMPORT_SOURCE_CHARS,
    IMPORT_PREVIEW_ROWS,
} from '../../../shared/database/imports/limits.js';
import express from 'express';
import { ImportService } from './imports.js';
import { requireThat } from '../../system/requests/errors.js';
import { choice, identifier, text } from '../../system/requests/validation.js';
import type { Driver } from '../../app/types.js';
import { principal, body, id, mappingFields, boolean } from '../../system/requests/http.js';

export function registerImportRoutes({
    app,
    driver,
    imports,
}: {
    app: ReturnType<typeof express>;
    driver: Driver;
    imports: ImportService;
}) {
    app.get('/api/imports', (req, res) => {
        const p = principal(res),
            connectionId =
                typeof req.query.connectionId === 'string'
                    ? text(req.query.connectionId, 'connectionId', 128)
                    : undefined;
        requireThat(
            req.query.recoverable === undefined || req.query.recoverable === 'true',
            400,
            'IMPORT_FILTER',
            'Use recoverable=true to list imports that need attention',
        );
        if (connectionId) driver.connection(p, connectionId);
        res.json(imports.listRecoverable(p, connectionId));
    });
    app.post('/api/imports/preview', (req, res) => {
        const v = body(req),
            format = choice(
                v.format,
                IMPORT_FORMATS,
                400,
                'IMPORT_FORMAT',
                'Use CSV, JSON, or NDJSON',
            );
        const input = imports.preview(
            principal(res),
            text(v.name, 'filename', 128),
            text(v.source, 'input', MAX_IMPORT_SOURCE_CHARS),
            format,
        );
        res.status(201).json({
            ...input,
            rows: input.rows.slice(0, IMPORT_PREVIEW_ROWS),
            rowCount: input.rows.length,
        });
    });
    app.post('/api/imports/:id/mapping', async (req, res) => {
        const v = body(req);
        let deduplicationToken: string | null | undefined;

        if (v.deduplicationToken === null) {
            deduplicationToken = null;
        } else if (v.deduplicationToken === undefined) {
            deduplicationToken = undefined;
        } else {
            deduplicationToken = text(v.deduplicationToken, 'deduplication token', 36);
        }
        const mapping = await imports.map(
            principal(res),
            id(req),
            identifier(v.connectionId, 'connectionId'),
            text(v.table, 'table', 256),
            mappingFields(v.fields),
            deduplicationToken,
        );
        res.json({
            ...mapping,
            ...(deduplicationToken === null ? { deduplicationToken: null } : {}),
            rows: mapping.rows.slice(0, IMPORT_PREVIEW_ROWS),
            rowCount: mapping.rows.length,
        });
    });
    app.post('/api/imports/:id/commit', async (req, res) =>
        res.json(await imports.commit(principal(res), id(req))),
    );
    app.get('/api/imports/:id', (req, res) => res.json(imports.getJob(principal(res), id(req))));
    app.post('/api/imports/:id/reconcile', async (req, res) =>
        res.json(await imports.reconcile(principal(res), id(req))),
    );
    app.post('/api/imports/:id/review', async (req, res) => {
        const v = body(req);
        res.json(
            await imports.review(
                principal(res),
                id(req),
                boolean(v.inspected, 'inspected'),
                boolean(v.noActiveInsert, 'noActiveInsert'),
            ),
        );
    });
    app.delete('/api/imports/:id', (req, res) => {
        imports.remove(principal(res), id(req));
        res.json({ ok: true });
    });
}
