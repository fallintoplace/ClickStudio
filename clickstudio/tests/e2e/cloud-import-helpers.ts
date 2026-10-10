import { expect, type Locator, type Page } from '@playwright/test';
import type { Schema } from '../../shared/types.js';
import type { CloudConnectionTest } from '../../web/cloud-connection.js';

export const previewCloudSchema: Schema = {
    connectionId: 'clickhouse-cloud',
    fetchedAt: '2026-09-28T00:00:00.000Z',
    databases: ['default'],
    tables: [{ database: 'default', name: 'events', engine: 'MergeTree' }],
    columns: [
        {
            database: 'default',
            table: 'events',
            name: 'day',
            type: 'Date',
            defaultKind: '',
            comment: '',
        },
        {
            database: 'default',
            table: 'events',
            name: 'events',
            type: 'UInt64',
            defaultKind: '',
            comment: '',
        },
    ],
    warnings: [],
    truncated: false,
};

const previewCloudConnectionTest: CloudConnectionTest = {
    host: 'service.region.provider.clickhouse.cloud:8443',
    database: 'default',
    username: 'demo',
    serverVersion: '26.1',
    queryLog: { available: true },
    queryLogSource: 'user_query_log',
    replication: { available: false, reason: 'Unavailable in this preview test.' },
    progress: { available: false, reason: 'Unavailable in this preview test.' },
    cancellation: { available: false, reason: 'Unavailable in this preview test.' },
    explain: { available: false, reason: 'Unavailable in this preview test.' },
    explainPlan: { available: false, reason: 'Unavailable in this preview test.' },
    explainAnalyze: { available: false, reason: 'Unavailable in this preview test.' },
    queryTree: { available: false, reason: 'Unavailable in this preview test.' },
    explainPipeline: { available: false, reason: 'Unavailable in this preview test.' },
    pipeline: { available: false, reason: 'Unavailable in this preview test.' },
    traceLog: { available: false, reason: 'Unavailable in this preview test.' },
    documentation: { available: false, reason: 'Unavailable in this preview test.' },
    parameters: { available: false, reason: 'Unavailable in this preview test.' },
};

export async function mockCloudEndpoint(
    page: Page,
    commitOutcome: 'success' | 'unknown' | 'running' = 'success',
    cloudSchema = previewCloudSchema,
    onSchemaAfterImport?: () => void,
) {
    const imports: string[] = [];
    let activeSchema = cloudSchema;
    let importSucceeded = false;
    await page.route('**/api/cloud', async route => {
        const request = route.request();
        const contentType = request.headers()['content-type'] ?? '';
        if (contentType.startsWith('multipart/form-data')) {
            const body = request.postData() ?? '';
            imports.push(body);
            const queryId =
                body.match(/name="queryId"\r\n\r\n([^\r\n]+)/)?.[1] ??
                'clickstudio-import-00000000-0000-4000-8000-000000000000';
            const table = body.match(/name="target"\r\n\r\n([^\r\n]+)/)?.[1] ?? 'default.events';
            const format = body.match(/name="format"\r\n\r\n([^\r\n]+)/)?.[1];
            const fileContents =
                body.match(
                    /name="file"; filename="[^\"]+"\r\nContent-Type: [^\r\n]+\r\n\r\n([\s\S]*?)\r\n--/,
                )?.[1] ?? '';
            const rows =
                format === 'json'
                    ? (JSON.parse(fileContents) as unknown[]).length
                    : format === 'ndjson'
                      ? fileContents.split(/\r?\n/).filter(Boolean).length
                      : Math.max(0, fileContents.trim().split(/\r?\n/).length - 1);
            const id = queryId.replace('clickstudio-import-', '');
            const createValue = body.match(/name="createTable"\r\n\r\n([^\r\n]+)/)?.[1];
            const createTable = createValue
                ? (JSON.parse(createValue) as {
                      name: string;
                      columns: { name: string; type: string }[];
                      generateId: boolean;
                  })
                : undefined;
            const targetValue = createTable ? `default.${createTable.name}` : table;
            const unresolvedOutcome =
                commitOutcome === 'unknown' ||
                (commitOutcome === 'running' && imports.length === 1);
            if (unresolvedOutcome) {
                const status = commitOutcome === 'unknown' ? 'unknown' : 'running';
                await route.fulfill({
                    json: {
                        id,
                        connectionId: 'clickhouse-cloud',
                        table: targetValue,
                        queryId,
                        rows,
                        createdAt: '2026-09-28T00:00:00.000Z',
                        status,
                        ...(status === 'unknown'
                            ? {
                                  tableExists: true,
                                  error: 'ClickHouse could not confirm the insert. The rows may already be there.',
                              }
                            : { reconciliationRequired: true }),
                    },
                });
                return;
            }
            if (createTable) {
                activeSchema = {
                    ...activeSchema,
                    tables: [
                        ...activeSchema.tables.filter(item => item.name !== createTable.name),
                        { database: 'default', name: createTable.name, engine: 'MergeTree' },
                    ],
                    columns: [
                        ...activeSchema.columns.filter(item => item.table !== createTable.name),
                        ...createTable.columns.map(column => ({
                            database: 'default',
                            table: createTable.name,
                            name: column.name,
                            type: column.type,
                            defaultKind: '',
                            comment: '',
                        })),
                        ...(createTable.generateId
                            ? [
                                  {
                                      database: 'default',
                                      table: createTable.name,
                                      name: 'id',
                                      type: 'UInt64',
                                      defaultKind: 'DEFAULT',
                                      comment: '',
                                  },
                              ]
                            : []),
                    ],
                };
            }
            importSucceeded = true;
            await route.fulfill({
                json: {
                    id,
                    connectionId: 'clickhouse-cloud',
                    table: targetValue,
                    queryId,
                    rows,
                    createdAt: '2026-09-28T00:00:00.000Z',
                    status: 'succeeded',
                },
            });
            return;
        }
        const body = request.postDataJSON() as {
            action?: string;
            queryId?: string;
            table?: string;
            rows?: number;
        };
        if (body.action === 'test') {
            await route.fulfill({ json: previewCloudConnectionTest });
            return;
        }
        if (body.action === 'schema') {
            if (importSucceeded) onSchemaAfterImport?.();
            await route.fulfill({ json: activeSchema });
            return;
        }
        if (body.action === 'import-status') {
            const running = commitOutcome === 'running';
            await route.fulfill({
                json: {
                    id: (body.queryId ?? '').replace('clickstudio-import-', ''),
                    connectionId: 'clickhouse-cloud',
                    table: body.table,
                    queryId: body.queryId,
                    rows: body.rows,
                    createdAt: '2026-09-28T00:00:00.000Z',
                    status: running ? 'running' : 'unknown',
                    ...(!running
                        ? {
                              tableExists: true,
                              error: 'ClickHouse could not confirm the insert. The rows may already be there.',
                          }
                        : { reconciliationRequired: true }),
                },
            });
            return;
        }
        await route.fulfill({
            status: 409,
            json: {
                error: {
                    code: 'UNEXPECTED_ACTION',
                    message: 'Unexpected Cloud action in this import test.',
                },
            },
        });
    });
    return imports;
}

export async function connectPreviewCloud(page: Page) {
    await page.goto('/');
    const connectButton = page.getByRole('button', { name: 'Connect Cloud' });
    await expect(connectButton).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Data source options' })).toHaveCount(0);
    await connectButton.click();
    const dialog = page.getByRole('dialog', { name: 'Connect to your service' });
    await dialog.getByLabel('HTTPS host').fill('service.region.provider.clickhouse.cloud:8443');
    await dialog.getByLabel('Database').fill('default');
    await dialog.getByLabel('Username').fill('demo');
    await dialog.getByLabel('Password').fill('demo-password');
    await dialog.getByRole('button', { name: 'Connect service' }).click();
    await expect(page.locator('.connection-trigger')).toContainText('CLICKHOUSE CLOUD');
    await expect(page.getByRole('button', { name: 'Disconnect Cloud' })).toBeVisible();
}

export async function chooseExistingCloudTable(dialog: Locator) {
    await dialog.getByRole('radio', { name: /Add to a table/ }).check();
    await dialog.getByLabel('Import target table').selectOption('default.events');
}
