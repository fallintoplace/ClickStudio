import { MONITOR_CONDITIONS } from '../shared/monitor-types.js';
import { randomUUID } from 'node:crypto';
import type { Monitor, Notice, Principal } from '../shared/types.js';
import { requireThat } from './errors.js';
import { canWrite, mustOwn } from './guards.js';
import { audit, hash, type Store } from './store.js';
import { integer } from './validation.js';
import { terminal, type RunService } from './runs.js';
import type { ArtifactService } from './artifacts.js';
/** Single-process, fixed-interval UTC scheduling. Notifications are owner-only and in-app. */
export class MonitorService {
    private ticking = false;
    constructor(
        private readonly store: Store,
        private readonly runs: RunService,
        private readonly artifacts: ArtifactService,
    ) {}
    create(
        p: Principal,
        publishedId: string,
        intervalSeconds: number,
        condition: Monitor['condition'],
    ): Monitor {
        canWrite(p);
        const pub = this.artifacts.published(p, publishedId);
        requireThat(
            pub.source === 'live-run',
            409,
            'MONITOR_SOURCE',
            'Imported evidence is not an executable published revision',
        );
        integer(intervalSeconds, 'intervalSeconds', 60, 31536000);
        requireThat(
            MONITOR_CONDITIONS.includes(condition),
            400,
            'MONITOR_CONDITION',
            'Invalid monitor condition',
        );
        requireThat(
            this.list(p).length < 20,
            429,
            'MONITOR_CAPACITY',
            'At most 20 monitors are supported',
        );
        const monitor: Monitor = {
            id: randomUUID(),
            owner: p.id,
            publishedId,
            intervalSeconds,
            condition,
            paused: false,
            createdAt: new Date().toISOString(),
            nextAt: new Date(Date.now() + intervalSeconds * 1000).toISOString(),
        };
        this.store.put('monitors', monitor.id, monitor);
        audit(this.store, p, 'monitor.create', monitor.id);
        return monitor;
    }
    list(p: Principal) {
        return this.store.list<Monitor>('monitors').filter(m => m.owner === p.id);
    }
    pause(p: Principal, id: string, paused: boolean) {
        canWrite(p);
        const monitor = this.store.get<Monitor>('monitors', id);
        requireThat(monitor, 404, 'NOT_FOUND', 'Monitor not found');
        mustOwn(p, monitor.owner);
        monitor.paused = paused;
        if (!paused) {
            this.artifacts.published(p, monitor.publishedId);
            monitor.nextAt = new Date(Date.now() + monitor.intervalSeconds * 1000).toISOString();
        }
        this.store.put('monitors', id, monitor);
        audit(this.store, p, paused ? 'monitor.pause' : 'monitor.resume', id);
        return monitor;
    }
    notices(p: Principal) {
        return this.store
            .list<Notice>('notices')
            .filter(n => n.owner === p.id)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    async tick(now = Date.now()) {
        if (this.ticking) return;
        this.ticking = true;
        try {
            for (const monitor of this.store.list<Monitor>('monitors')) {
                if (monitor.paused || Date.parse(monitor.nextAt) > now) continue;
                const p: Principal = { id: monitor.owner, role: 'owner' },
                    slot = monitor.nextAt;
                try {
                    if (monitor.lastRunId && !terminal(this.runs.get(p, monitor.lastRunId)))
                        continue;
                    const pub = this.artifacts.published(p, monitor.publishedId);
                    const run = this.runs.submit(p, {
                        clientRequestId: `monitor-${monitor.id}-${Date.parse(slot)}`,
                        connectionId: pub.document.connectionId,
                        sql: pub.document.sql,
                        parameters: pub.document.parameters,
                        limits: pub.run.limits,
                        tags: { artifact: pub.documentId, workspace: 'monitor' },
                        parentRunId: undefined,
                    });
                    // Persist only after submit has durably reserved the run. Reusing the slot is
                    // idempotent after a crash.
                    monitor.lastRunId = run.id;
                    monitor.nextAt = new Date(now + monitor.intervalSeconds * 1000).toISOString();
                    this.store.put('monitors', monitor.id, monitor);
                    void this.evaluate(p, monitor.id, run.id).catch(() =>
                        this.notify(monitor, run.id, 'failure'),
                    );
                } catch {
                    monitor.paused = true;
                    this.store.put('monitors', monitor.id, monitor);
                    this.notify(monitor, monitor.lastRunId ?? '', 'failure');
                    audit(
                        this.store,
                        p,
                        'monitor.blocked',
                        monitor.id,
                        'denied',
                        'MONITOR_PERMISSION_OR_REVISION',
                    );
                }
            }
        } finally {
            this.ticking = false;
        }
    }
    private async evaluate(p: Principal, id: string, runId: string) {
        const run = await this.runs.wait(p, runId),
            monitor = this.store.get<Monitor>('monitors', id);
        if (!monitor) return;
        if (run.status !== 'succeeded' && run.status !== 'truncated') {
            this.notify(monitor, runId, 'failure');
            return;
        }
        try {
            const result = this.runs.result(p, runId),
                currentHash = hash([result.columns, result.rows, result.completeness]);
            if (
                monitor.condition === 'changed' &&
                monitor.lastHash !== undefined &&
                monitor.lastHash !== currentHash
            )
                this.notify(monitor, runId, 'changed');
            if (monitor.condition === 'nonempty' && result.rows.length)
                this.notify(monitor, runId, 'nonempty');
            monitor.lastHash = currentHash;
            this.store.put('monitors', id, monitor);
        } catch {
            this.notify(monitor, runId, 'failure');
        }
    }
    private notify(monitor: Monitor, runId: string, reason: Notice['reason']) {
        const notice: Notice = {
            id: randomUUID(),
            owner: monitor.owner,
            monitorId: monitor.id,
            runId,
            reason,
            read: false,
            createdAt: new Date().toISOString(),
        };
        this.store.put('notices', notice.id, notice);
        const all = this.store
            .list<Notice>('notices')
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (const old of all.slice(0, Math.max(0, all.length - 500)))
            this.store.delete('notices', old.id);
    }
}
