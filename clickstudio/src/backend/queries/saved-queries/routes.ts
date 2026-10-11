import express from 'express';
import { ArtifactService } from './documents.js';
import { requireThat } from '../../system/requests/errors.js';
import { integer, text } from '../../system/requests/validation.js';
import type { Driver } from '../../app/types.js';
import type { createSecretGuards } from '../../system/requests/secrets.js';
import { principal, id, body } from '../../system/requests/http.js';

export function registerDocumentRoutes({
    app,
    driver,
    artifacts,
    safeExport,
}: {
    app: ReturnType<typeof express>;
    driver: Driver;
    artifacts: ArtifactService;
    safeExport: ReturnType<typeof createSecretGuards>['safeExport'];
}) {
    app.get('/api/documents', (req, res) => {
        const connectionId =
            typeof req.query.connectionId === 'string'
                ? text(req.query.connectionId, 'connectionId', 128)
                : undefined;
        if (connectionId) driver.connection(principal(res), connectionId);
        res.json(artifacts.list(principal(res), req.query.trash === 'true', connectionId));
    });
    app.post('/api/documents', (req, res) =>
        res.status(201).json(artifacts.save(principal(res), req.body)),
    );
    app.get('/api/documents/:id', (req, res) =>
        res.json(
            artifacts.get(
                principal(res),
                id(req),
                req.query.revision === undefined
                    ? undefined
                    : integer(Number(req.query.revision), 'revision', 1, 1e6),
            ),
        ),
    );
    app.put('/api/documents/:id', (req, res) =>
        res.json(artifacts.save(principal(res), req.body, id(req))),
    );
    app.get('/api/documents/:id/revisions', (req, res) =>
        res.json(artifacts.revisions(principal(res), id(req))),
    );
    app.post('/api/documents/:id/restore-revision', (req, res) => {
        const v = body(req);
        res.json(
            artifacts.restoreRevision(
                principal(res),
                id(req),
                integer(v.revision, 'revision', 1, 1e6),
                integer(v.baseRevision, 'baseRevision', 1, 1e6),
            ),
        );
    });
    app.delete('/api/documents/:id', (req, res) =>
        res.json(artifacts.trash(principal(res), id(req), body(req).confirmImpact === true)),
    );
    app.post('/api/documents/:id/restore', (req, res) =>
        res.json(artifacts.restore(principal(res), id(req))),
    );
    app.get('/api/documents/:id/impact', (req, res) => {
        artifacts.get(principal(res), id(req));
        res.json(artifacts.descendants(principal(res), id(req)));
    });
    app.post('/api/documents/:id/review', (req, res) =>
        res.json(
            artifacts.review(
                principal(res),
                id(req),
                integer(body(req).revision, 'revision', 1, 1e6),
            ),
        ),
    );
    app.post('/api/documents/:id/publish', (req, res) => {
        const v = body(req),
            pub = artifacts.publish(
                principal(res),
                id(req),
                integer(v.revision, 'revision', 1, 1e6),
                v.acknowledgeTruncated === true,
            );
        res.json(pub);
    });
    app.get('/api/documents/:id/comments', (req, res) =>
        res.json(artifacts.comments(principal(res), id(req))),
    );
    app.post('/api/documents/:id/comments', (req, res) =>
        res.status(201).json(artifacts.comment(principal(res), id(req), req.body)),
    );
    app.get('/api/workspace/export', (_req, res) => {
        const bundle = artifacts.export(principal(res));
        safeExport(bundle);
        res.attachment('query-studio-workspace.json').json(bundle);
    });
    app.post('/api/workspace/import', (req, res) =>
        res.status(201).json(artifacts.import(principal(res), req.body)),
    );
    app.get('/api/published', (_req, res) => res.json(artifacts.publications(principal(res))));
    app.get('/api/published/:id', (req, res) =>
        res.json(artifacts.published(principal(res), id(req))),
    );
    app.post('/api/published/:id/share', (req, res) => {
        requireThat(
            body(req).acknowledgeShare === true,
            400,
            'SHARE_CONSENT',
            'A share link exposes SQL, bound parameters, execution metadata, chart configuration and the bounded result to anyone holding it',
        );
        const pub = artifacts.published(principal(res), id(req));
        safeExport(pub);
        const share = artifacts.share(principal(res), pub.id);
        res.json({ ...share, path: `/share/${share.token}` });
    });
    app.delete('/api/published/:id/share', (req, res) => {
        artifacts.revokeShares(principal(res), id(req));
        res.json({ ok: true });
    });
    app.delete('/api/published/:id', (req, res) => {
        artifacts.deletePublication(principal(res), id(req));
        res.json({ ok: true });
    });
}
