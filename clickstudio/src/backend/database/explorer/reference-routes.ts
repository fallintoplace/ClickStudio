import express from 'express';
import type {
    ClickHouseDocumentationEntry,
    ClickHouseDocumentationSummary,
} from '../../../shared/database/reference/types.js';
import type { Principal } from '../../../shared/common/identity.js';
import { requireThat } from '../../system/requests/errors.js';
import { text } from '../../system/requests/validation.js';
import { isReferenceCategory } from '../../../shared/database/reference/reference.js';
import type { Driver } from '../../app/types.js';
import { principal, id } from '../../system/requests/http.js';

export function registerDocumentationRoutes({
    authorized,
    driver,
    app,
}: {
    authorized: (p: Principal, c: string) => boolean;
    driver: Driver;
    app: ReturnType<typeof express>;
}) {
    const requireDocumentation = (p: Principal, connectionId: string) => {
        requireThat(
            authorized(p, connectionId),
            403,
            'WORKSPACE_UNTRUSTED',
            'Trust this connection before inspecting its documentation',
        );
        const capability = driver.connection(p, connectionId).manifest?.documentation;
        requireThat(
            capability?.available !== false,
            409,
            'CAPABILITY_UNAVAILABLE',
            capability?.reason ??
                'ClickHouse reference documentation is unavailable for this connection',
        );
    };
    app.get('/api/connections/:id/documentation/search', async (req, res) => {
        const p = principal(res),
            connectionId = id(req);
        requireDocumentation(p, connectionId);
        requireThat(
            req.query.query === undefined || typeof req.query.query === 'string',
            400,
            'INVALID_REQUEST',
            'query must be a single string value',
        );
        requireThat(
            req.query.category === undefined || typeof req.query.category === 'string',
            400,
            'INVALID_REQUEST',
            'category must be a single string value',
        );
        const query = typeof req.query.query === 'string' ? req.query.query : '';
        const category = typeof req.query.category === 'string' ? req.query.category : 'all';
        requireThat(
            query.length <= 128,
            400,
            'INVALID_REQUEST',
            'query must be 128 characters or fewer',
        );
        requireThat(
            isReferenceCategory(category),
            400,
            'INVALID_REQUEST',
            'Unknown ClickHouse reference category',
        );
        const entries: ClickHouseDocumentationSummary[] = await driver.searchDocumentation(
            connectionId,
            query,
            category,
        );
        res.json(entries);
    });
    app.get('/api/connections/:id/documentation/entry', async (req, res) => {
        const p = principal(res),
            connectionId = id(req);
        requireDocumentation(p, connectionId);
        const name = text(req.query.name, 'name', 128),
            type = text(req.query.type, 'type', 80);
        const entry: ClickHouseDocumentationEntry | undefined = await driver.documentationEntry(
            connectionId,
            name,
            type,
        );
        requireThat(
            entry,
            404,
            'DOCUMENTATION_NOT_FOUND',
            `No ClickHouse documentation is available for ${type} ${name}`,
        );
        res.json(entry);
    });
    app.get('/api/connections/:id/documentation', async (req, res) => {
        const p = principal(res),
            connectionId = id(req);
        requireDocumentation(p, connectionId);
        const name = text(req.query.name, 'name', 128);
        const entry = await driver.documentationEntry(connectionId, name, 'System Table');
        requireThat(
            entry,
            404,
            'DOCUMENTATION_NOT_FOUND',
            `No ClickHouse documentation is available for system.${name}`,
        );
        res.json(entry);
    });
}
