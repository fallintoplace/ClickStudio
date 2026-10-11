import { CHART_KINDS } from '../../../shared/queries/results/chart-types.js';
import { MAX_SQL_CHARS } from '../../../shared/queries/execution/limits.js';
import { randomUUID, randomBytes } from 'node:crypto';
import type { ChartConfig } from '../../../shared/queries/results/chart-settings.js';
import type {
    Comment,
    MetricContract,
    Published,
    QueryDocument,
} from '../../../shared/queries/saved-queries/types.js';
import type { Principal } from '../../../shared/common/identity.js';
import { DEFAULT_LIMITS } from '../../../shared/queries/execution/settings.js';
import { AppError, requireThat } from '../../system/requests/errors.js';
import { canWrite, mustOwn } from '../../system/login/permissions.js';
import { hash, audit, MemoryStore, type Store } from '../../system/storage/store.js';
import { choice, integer, record, stringMap, text } from '../../system/requests/validation.js';
import { boundResult, type RunService } from '../execution/runs.js';
import { MAX_CHART_SERIES } from '../../../shared/queries/results/results.js';
interface Share {
    id: string;
    owner: string;
    publishedId: string;
    expiresAt: string;
}
const DOCUMENT_KINDS = [
    'query',
    'snippet',
    'metric',
] as const satisfies readonly QueryDocument['kind'][];
const LEGACY_CHART_KINDS = ['area', 'stacked', 'pie'] as const;
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}
export class ArtifactService {
    constructor(
        private readonly store: Store,
        private readonly runs: RunService,
        private readonly authorizeConnection: (p: Principal, id: string) => void,
    ) {}
    list(p: Principal, includeTrash = false, connectionId?: string): QueryDocument[] {
        return this.store
            .list<QueryDocument>('documents')
            .filter(
                d =>
                    d.owner === p.id &&
                    (!connectionId || d.connectionId === connectionId) &&
                    (includeTrash || !d.deletedAt),
            )
            .map(document => this.normalizeDocument(document));
    }
    private normalizeDocument(document: QueryDocument): QueryDocument {
        return { ...document, chart: parseChart(document.chart) };
    }
    get(p: Principal, id: string, revision?: number): QueryDocument {
        const current = this.store.get<QueryDocument>('documents', id);
        requireThat(current, 404, 'NOT_FOUND', 'Document not found');
        mustOwn(p, current.owner);
        if (revision === undefined) return this.normalizeDocument(current);
        const historical = this.store.get<QueryDocument>('revisions', `${id}-${revision}`);
        requireThat(historical, 404, 'REVISION_NOT_FOUND', 'Revision not found');
        return this.normalizeDocument(historical);
    }
    revisions(p: Principal, id: string): QueryDocument[] {
        this.get(p, id);
        return this.store
            .list<QueryDocument>('revisions')
            .filter(d => d.id === id)
            .sort((a, b) => b.revision - a.revision)
            .map(document => this.normalizeDocument(document));
    }
    save(p: Principal, value: unknown, id?: string): QueryDocument {
        canWrite(p);
        const input = record(value),
            old = id ? this.get(p, id) : undefined;
        requireThat(
            !old?.deletedAt,
            409,
            'DOCUMENT_DELETED',
            'Restore this document before editing',
        );
        if (old)
            requireThat(
                integer(input.baseRevision, 'baseRevision', 1, 1000000) === old.revision,
                409,
                'REVISION_CONFLICT',
                'A newer revision exists. Compare it with your draft; nothing was overwritten.',
            );
        else
            requireThat(
                this.list(p).length < 200,
                507,
                'DOCUMENT_CAPACITY',
                'This workspace has reached its 200-active-document limit',
            );
        const connectionId = text(input.connectionId, 'connectionId', 128);
        this.authorizeConnection(p, connectionId);
        const kind = choice(
            input.kind ?? old?.kind ?? 'query',
            DOCUMENT_KINDS,
            400,
            'ARTIFACT_KIND',
            'Unknown document kind',
        );
        const dependencies = input.dependencies ?? old?.dependencies ?? [];
        requireThat(
            isStringArray(dependencies) && dependencies.length <= 50,
            400,
            'DEPENDENCIES',
            'Invalid dependencies',
        );
        const documentId = id ?? randomUUID();
        for (const dependency of dependencies) {
            const source = this.get(p, dependency);
            requireThat(
                !source.deletedAt && source.id !== documentId,
                409,
                'BROKEN_DEPENDENCY',
                'Cannot reference a deleted artifact or itself',
            );
            requireThat(
                !this.descendants(p, documentId).includes(dependency),
                409,
                'DEPENDENCY_CYCLE',
                'This reference would create a dependency cycle',
            );
        }
        const now = new Date().toISOString();
        const document: QueryDocument = {
            id: documentId,
            owner: p.id,
            name: text(input.name, 'name', 180),
            sql: text(input.sql, 'SQL', MAX_SQL_CHARS, true),
            connectionId,
            revision: (old?.revision ?? 0) + 1,
            createdAt: old?.createdAt ?? now,
            updatedAt: now,
            parameters: stringMap(input.parameters, 'parameters'),
            chart: parseChart(input.chart),
            dependencies,
            kind,
            publishedRevision: old?.publishedRevision,
            ...(old?.parentDocumentId ? { parentDocumentId: old.parentDocumentId } : {}),
        };
        if (input.parentDocumentId !== undefined) {
            const parent = this.get(p, text(input.parentDocumentId, 'parentDocumentId', 128));
            requireThat(
                parent.connectionId === connectionId,
                409,
                'CONNECTION_MISMATCH',
                'An experiment must use its parent connection',
            );
            document.parentDocumentId = parent.id;
        }
        if (input.runId) {
            const run = this.runs.get(p, text(input.runId, 'runId', 128));
            requireThat(
                run.connectionId === connectionId,
                409,
                'CONNECTION_MISMATCH',
                'The run belongs to a different connection',
            );
            document.runId = run.id;
        }
        if (document.kind === 'metric') document.metric = parseMetric(input.metric);
        // Verification is attached to logic, not a title. Carry it forward only for unchanged
        // logic.
        if (
            old?.verifiedRevision &&
            old.sql === document.sql &&
            hash(old.parameters) === hash(document.parameters) &&
            old.connectionId === connectionId &&
            hash(old.metric) === hash(document.metric)
        )
            document.verifiedRevision = document.revision;
        this.store.put('revisions', `${document.id}-${document.revision}`, document);
        this.store.put('documents', document.id, document);
        audit(this.store, p, 'document.save', document.id);
        return document;
    }
    descendants(p: Principal, id: string): string[] {
        const docs = this.list(p, true),
            found = new Set<string>();
        const visit = (parent: string) => {
            for (const d of docs)
                if (d.dependencies.includes(parent) && !found.has(d.id)) {
                    found.add(d.id);
                    visit(d.id);
                }
        };
        visit(id);
        return [...found];
    }
    restoreRevision(
        p: Principal,
        id: string,
        revision: number,
        baseRevision: number,
    ): QueryDocument {
        const old = this.get(p, id, revision);
        return this.save(p, { ...old, baseRevision, runId: undefined }, id);
    }
    trash(p: Principal, id: string, confirmImpact = false): QueryDocument {
        canWrite(p);
        const d = this.get(p, id);
        requireThat(
            confirmImpact || this.descendants(p, id).length === 0,
            409,
            'DOWNSTREAM_IMPACT',
            'Review dependent artifacts before deleting this document',
        );
        d.deletedAt = new Date().toISOString();
        this.store.put('documents', id, d);
        audit(this.store, p, 'document.trash', id);
        return d;
    }
    restore(p: Principal, id: string): QueryDocument {
        canWrite(p);
        const d = this.get(p, id);
        if (d.deletedAt)
            requireThat(
                this.list(p).length < 200,
                507,
                'DOCUMENT_CAPACITY',
                'This workspace has reached its 200-active-document limit',
            );
        delete d.deletedAt;
        this.store.put('documents', id, d);
        audit(this.store, p, 'document.restore', id);
        return d;
    }
    review(p: Principal, id: string, revision: number): QueryDocument {
        canWrite(p);
        const d = this.get(p, id);
        requireThat(
            d.revision === revision && !d.deletedAt,
            409,
            'REVISION_CONFLICT',
            'Review the current active revision',
        );
        d.verifiedRevision = revision;
        this.store.put('documents', id, d);
        audit(this.store, p, 'document.self-review', id);
        return d;
    }
    publish(p: Principal, id: string, revision: number, acknowledgeTruncated = false): Published {
        canWrite(p);
        const d = this.get(p, id);
        requireThat(
            d.revision === revision && !d.deletedAt,
            409,
            'REVISION_CONFLICT',
            'Publish the current active revision',
        );
        this.authorizeConnection(p, d.connectionId);
        requireThat(
            d.runId,
            409,
            'EVIDENCE_REQUIRED',
            'Run and save this exact query before publishing',
        );
        const run = this.runs.get(p, d.runId),
            result = this.runs.result(p, d.runId);
        requireThat(
            run.sql.trim() === d.sql.trim() &&
                hash(run.parameters) === hash(d.parameters) &&
                run.kind === 'query',
            409,
            'STALE_EVIDENCE',
            'The retained result does not match the current SQL and parameters',
        );
        requireThat(
            run.status === 'succeeded' || run.status === 'truncated',
            409,
            'EVIDENCE_REQUIRED',
            'Only completed result evidence can be published',
        );
        const bounded = boundResult(
            {
                columns: result.columns,
                rows: result.rows,
                truncated: result.completeness === 'truncated',
            },
            { ...DEFAULT_LIMITS, rows: 1000, bytes: 1000000 },
        );
        requireThat(
            !bounded.truncated || acknowledgeTruncated,
            409,
            'TRUNCATION_ACK_REQUIRED',
            'Publishing will share a bounded snapshot. Acknowledge truncation first.',
        );
        for (const dep of d.dependencies) {
            const source = this.get(p, dep);
            requireThat(
                !source.deletedAt,
                409,
                'BROKEN_DEPENDENCY',
                'A referenced artifact is in trash',
            );
        }
        const publishedId = hash([id, revision, d.runId]);
        const prior = this.store.get<Published>('published', publishedId);
        const now = Date.now();
        if (prior && Date.parse(prior.expiresAt) > now) return prior;
        requireThat(
            this.store
                .list<Published>('published')
                .filter(publication => Date.parse(publication.expiresAt) > now).length < 50,
            507,
            'PUBLICATION_CAPACITY',
            'Remove an older publication before publishing another',
        );
        const expiresAt = new Date(now + 7 * 86400000).toISOString();
        const pub: Published = {
            id: publishedId,
            owner: p.id,
            documentId: id,
            revision,
            publishedAt: new Date().toISOString(),
            expiresAt,
            document: structuredClone(d),
            run,
            result: {
                ...result,
                rows: bounded.rows,
                completeness: bounded.truncated ? 'truncated' : 'complete',
                expiresAt,
            },
            resultLifetime: 'snapshot',
            source: run.dataSource === 'fixture' ? 'fixture' : 'live-run',
        };
        this.store.put('published', publishedId, pub);
        d.publishedRevision = revision;
        this.store.put('documents', d.id, d);
        audit(this.store, p, 'document.publish', publishedId);
        return pub;
    }
    published(p: Principal, id: string): Published {
        const pub = this.store.get<Published>('published', id);
        requireThat(pub, 404, 'NOT_FOUND', 'Published revision not found');
        mustOwn(p, pub.owner);
        requireThat(
            Date.parse(pub.expiresAt) > Date.now(),
            410,
            'SNAPSHOT_EXPIRED',
            'This published snapshot expired',
        );
        return pub;
    }
    publications(p: Principal): Published[] {
        return this.store
            .list<Published>('published')
            .filter(v => v.owner === p.id && Date.parse(v.expiresAt) > Date.now());
    }
    share(
        p: Principal,
        publishedId: string,
    ): {
        token: string;
        expiresAt: string;
    } {
        canWrite(p);
        const pub = this.published(p, publishedId),
            token = randomBytes(32).toString('base64url');
        const share: Share = {
            id: hash(token),
            owner: p.id,
            publishedId,
            expiresAt: pub.expiresAt,
        };
        this.store.put('shares', share.id, share);
        audit(this.store, p, 'snapshot.share', publishedId);
        return { token, expiresAt: share.expiresAt };
    }
    resolveShare(token: string): Published {
        requireThat(/^[A-Za-z0-9_-]{43}$/.test(token), 404, 'NOT_FOUND', 'Share not found');
        const share = this.store.get<Share>('shares', hash(token));
        requireThat(share, 404, 'NOT_FOUND', 'Share not found');
        requireThat(
            Date.parse(share.expiresAt) > Date.now(),
            410,
            'SHARE_EXPIRED',
            'This share link expired',
        );
        return this.published({ id: share.owner, role: 'viewer' }, share.publishedId);
    }
    revokeShares(p: Principal, publishedId: string) {
        canWrite(p);
        this.published(p, publishedId);
        for (const share of this.store.list<Share>('shares'))
            if (share.publishedId === publishedId) this.store.delete('shares', share.id);
        audit(this.store, p, 'snapshot.revoke-shares', publishedId);
    }
    deletePublication(p: Principal, id: string) {
        canWrite(p);
        const pub = this.store.get<Published>('published', id);
        requireThat(pub, 404, 'NOT_FOUND', 'Published revision not found');
        mustOwn(p, pub.owner);
        for (const share of this.store.list<Share>('shares'))
            if (share.publishedId === id) this.store.delete('shares', share.id);
        this.store.delete('published', id);
        audit(this.store, p, 'snapshot.delete', id);
    }
    comment(p: Principal, id: string, value: unknown): Comment {
        canWrite(p);
        const v = record(value),
            revision = integer(v.revision, 'revision', 1, 1000000),
            d = this.get(p, id, revision);
        const a = v.anchor === undefined ? {} : record(v.anchor),
            anchor: Comment['anchor'] = {};
        if (a.from !== undefined) {
            anchor.from = integer(a.from, 'from', 0, d.sql.length);
            anchor.to = integer(a.to, 'to', anchor.from, d.sql.length);
        }
        if (a.runId !== undefined) {
            const run = this.runs.get(p, text(a.runId, 'runId', 128));
            requireThat(
                run.connectionId === d.connectionId,
                409,
                'CONNECTION_MISMATCH',
                'Comment evidence belongs to another connection',
            );
            anchor.runId = run.id;
            if (a.column !== undefined)
                anchor.column = integer(a.column, 'column', 0, run.columns.length - 1);
        }
        const comment: Comment = {
            id: randomUUID(),
            owner: p.id,
            documentId: id,
            revision,
            anchor,
            text: text(v.text, 'comment', 10000),
            createdAt: new Date().toISOString(),
        };
        this.store.put('comments', comment.id, comment);
        return comment;
    }
    comments(p: Principal, id: string): Comment[] {
        this.get(p, id);
        return this.store
            .list<Comment>('comments')
            .filter(c => c.documentId === id && c.owner === p.id);
    }
    export(p: Principal) {
        return {
            format: 'clickstudio-workspace',
            version: 1,
            exportedAt: new Date().toISOString(),
            documents: this.list(p),
        };
    }
    import(p: Principal, value: unknown): QueryDocument[] {
        canWrite(p);
        const v = record(value);
        requireThat(
            v.format === 'clickstudio-workspace' &&
                v.version === 1 &&
                Array.isArray(v.documents) &&
                v.documents.length <= 100,
            400,
            'BUNDLE_FORMAT',
            'Unsupported workspace bundle',
        );
        // Validate the complete bundle in isolation before changing durable state. This avoids
        // partial imports on validation errors; filesystem failures are still not transactions.
        const staged = new MemoryStore();
        for (const current of this.store.list<QueryDocument>('documents'))
            staged.put('documents', current.id, current);
        const staging = new ArtifactService(staged, this.runs, this.authorizeConnection);
        const documents = v.documents.map(raw => {
            const d = record(raw);
            // Imported ownership, verification, run IDs, dependencies and trust are not authority.
            return staging.save(p, {
                name: d.name,
                sql: d.sql,
                connectionId: d.connectionId,
                parameters: d.parameters,
                chart: d.chart,
                kind: d.kind,
                metric: d.metric,
                dependencies: [],
            });
        });
        for (const document of documents) {
            this.store.put('revisions', `${document.id}-1`, document);
            this.store.put('documents', document.id, document);
            audit(this.store, p, 'document.import', document.id);
        }
        return documents;
    }
    sweep() {
        for (const pub of this.store.list<Published>('published'))
            if (Date.parse(pub.expiresAt) <= Date.now() && pub.result.rows.length) {
                pub.result.rows = [];
                this.store.put('published', pub.id, pub);
            }
        for (const s of this.store.list<Share>('shares'))
            if (Date.parse(s.expiresAt) <= Date.now()) this.store.delete('shares', s.id);
    }
}
export function parseChart(value: unknown): ChartConfig {
    if (value === undefined) return { kind: 'table', x: 0, ys: [], title: 'Query result' };
    const v = record(value),
        kind = CHART_KINDS.find(candidate => candidate === v.kind);
    requireThat(
        kind !== undefined || LEGACY_CHART_KINDS.some(candidate => candidate === v.kind),
        400,
        'CHART_CONFIG',
        'Invalid chart kind',
    );
    requireThat(
        Array.isArray(v.ys) && v.ys.length <= MAX_CHART_SERIES,
        400,
        'CHART_CONFIG',
        'Invalid chart series',
    );
    const groupBy = v.groupBy === undefined ? undefined : integer(v.groupBy, 'groupBy', 0, 499);
    let candlestick: ChartConfig['candlestick'];
    if (kind === 'candlestick') {
        const fields = record(v.candlestick, 'candlestick fields');
        candlestick = {
            ...(fields.open === undefined
                ? {}
                : { open: integer(fields.open, 'candlestick.open', 0, 499) }),
            ...(fields.high === undefined
                ? {}
                : { high: integer(fields.high, 'candlestick.high', 0, 499) }),
            ...(fields.low === undefined
                ? {}
                : { low: integer(fields.low, 'candlestick.low', 0, 499) }),
            ...(fields.close === undefined
                ? {}
                : { close: integer(fields.close, 'candlestick.close', 0, 499) }),
            ...(fields.bid === undefined
                ? {}
                : { bid: integer(fields.bid, 'candlestick.bid', 0, 499) }),
            ...(fields.ask === undefined
                ? {}
                : { ask: integer(fields.ask, 'candlestick.ask', 0, 499) }),
            ...(fields.spread === undefined
                ? {}
                : { spread: integer(fields.spread, 'candlestick.spread', 0, 499) }),
            ...(fields.quoteActivity === undefined
                ? {}
                : {
                      quoteActivity: integer(
                          fields.quoteActivity,
                          'candlestick.quoteActivity',
                          0,
                          499,
                      ),
                  }),
        };
    }
    return {
        kind: kind ?? 'table',
        x: integer(v.x, 'x', 0, 499),
        ...(groupBy === undefined ? {} : { groupBy }),
        ys: v.ys.map(y => integer(y, 'y', 0, 499)),
        title: text(v.title, 'chart title', 200, true),
        ...(candlestick ? { candlestick } : {}),
    };
}
function parseMetric(value: unknown): MetricContract {
    const v = record(value, 'metric contract'),
        timezone = text(v.timezone, 'timezone', 100);
    try {
        new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch {
        throw new AppError(400, 'TIMEZONE', 'Use a valid IANA timezone');
    }
    const list = (x: unknown, name: string) => {
        requireThat(Array.isArray(x) && x.length <= 100, 400, 'METRIC_CONTRACT', `Invalid ${name}`);
        return x.map(s => text(s, name, 256));
    };
    return {
        definition: text(v.definition, 'definition', 2000),
        grain: text(v.grain, 'grain', 500),
        dimensions: list(v.dimensions, 'dimensions'),
        timezone,
        filters: text(v.filters, 'filters', 2000, true),
        nullTreatment: text(v.nullTreatment, 'nullTreatment', 1000),
        sourceColumns: list(v.sourceColumns, 'sourceColumns'),
    };
}
