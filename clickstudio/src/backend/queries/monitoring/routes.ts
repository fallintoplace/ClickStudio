import { MONITOR_CONDITIONS } from '../../../shared/queries/monitoring/conditions.js';
import express from 'express';
import type { AuditEvent } from '../../../shared/common/identity.js';
import { MonitorService } from './monitors.js';
import { type Store } from '../../system/storage/store.js';
import { choice, identifier, integer } from '../../system/requests/validation.js';
import { principal, body, id, boolean } from '../../system/requests/http.js';

export function registerMonitorRoutes({
    app,
    monitors,
    store,
}: {
    app: ReturnType<typeof express>;
    monitors: MonitorService;
    store: Store;
}) {
    app.get('/api/monitors', (_req, res) => res.json(monitors.list(principal(res))));
    app.post('/api/monitors', (req, res) => {
        const v = body(req),
            condition = choice(
                v.condition,
                MONITOR_CONDITIONS,
                400,
                'MONITOR_CONDITION',
                'Invalid condition',
            );
        res.status(201).json(
            monitors.create(
                principal(res),
                identifier(v.publishedId, 'publishedId'),
                integer(v.intervalSeconds, 'intervalSeconds', 60, 31536000),
                condition,
            ),
        );
    });
    app.post('/api/monitors/:id/pause', (req, res) =>
        res.json(monitors.pause(principal(res), id(req), boolean(body(req).paused, 'paused'))),
    );
    app.get('/api/notices', (_req, res) => res.json(monitors.notices(principal(res))));
    app.get('/api/audit', (_req, res) =>
        res.json(
            store
                .list<AuditEvent>('audit')
                .filter(e => e.owner === principal(res).id)
                .sort((a, b) => b.at.localeCompare(a.at))
                .slice(0, 200),
        ),
    );
}
