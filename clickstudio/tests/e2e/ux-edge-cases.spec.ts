import { test, expect } from '@playwright/test';
import { replaceSql, trust } from './helpers.js';

test('An empty truncated retained result does not claim the query matched no rows', async ({
    page,
}) => {
    await page.route(
        url => url.pathname.endsWith('/result'),
        async route => {
            const response = await route.fetch();
            const result = await response.json();
            await route.fulfill({
                response,
                json: {
                    ...result,
                    rows: [],
                    totalRows: 0,
                    nextOffset: null,
                    completeness: 'truncated',
                },
            });
        },
    );
    await trust(page);
    await page.getByTestId('run-button').click();
    const results = page.getByRole('region', { name: 'Query results' });
    await expect(results.getByText(/No rows fit in the retained result\./)).toBeVisible();
    await expect(results.getByText('This query returned zero rows.')).toHaveCount(0);
});

test('Statements without a result set do not show the empty SELECT message', async ({ page }) => {
    const retained = new Map<
        string,
        { run: Record<string, unknown>; result: Record<string, unknown> }
    >();
    let sequence = 0;
    await page.route('**/api/runs**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'POST' && url.pathname === '/api/runs') {
            const input = request.postDataJSON() as { connectionId: string; sql: string };
            const id = `outcome-run-${++sequence}`;
            const createdAt = new Date(Date.UTC(2026, 0, sequence)).toISOString();
            const isSelect = /^\s*SELECT\b/i.test(input.sql);
            const columns = isSelect ? [{ name: 'value', type: 'UInt64' }] : [];
            const writtenRows = /^\s*INSERT\b/i.test(input.sql)
                ? 2
                : /^\s*(?:DELETE|CREATE)\b/i.test(input.sql)
                  ? 0
                  : undefined;
            const run = {
                dataSource: 'fixture',
                id,
                queryId: `outcome-query-${sequence}`,
                owner: 'local-owner',
                connectionId: input.connectionId,
                sql: input.sql,
                kind: 'query',
                parameters: {},
                limits: { rows: 5000, bytes: 2000000, seconds: 30, memory: 536870912, threads: 4 },
                tags: {},
                status: 'succeeded',
                createdAt,
                finishedAt: createdAt,
                elapsedMs: 1,
                rowCount: 0,
                ...(writtenRows === undefined ? {} : { writtenRows }),
                bytes: 0,
                columns,
                warnings: [],
                sequence,
                resultExpiresAt: '2027-01-01T00:00:00.000Z',
                resultState: 'reopenable',
                requestedBy: 'local-owner',
                executedAs: 'fixture-reader',
                permissionSnapshot: { readonly: false, role: 'owner' },
                retryPolicy: 'never',
            };
            const result = {
                runId: id,
                queryId: run.queryId,
                columns,
                rows: [],
                completeness: 'complete',
                createdAt,
                expiresAt: '2027-01-01T00:00:00.000Z',
            };
            retained.set(id, { run, result });
            await route.fulfill({ json: run });
            return;
        }
        if (url.pathname === '/api/runs') {
            await route.fulfill({ json: [...retained.values()].map(entry => entry.run) });
            return;
        }
        const match = url.pathname.match(
            /^\/api\/runs\/(outcome-run-\d+)(?:\/(snapshot|result))?$/,
        );
        const entry = match ? retained.get(match[1]!) : undefined;
        if (!entry || !match) {
            await route.fulfill({
                status: 404,
                json: {
                    error: { code: 'RUN_NOT_FOUND', message: 'The mocked run was not found.' },
                },
            });
            return;
        }
        if (match[2] === 'result') {
            await route.fulfill({
                json: { ...entry.result, offset: 0, totalRows: 0, nextOffset: null },
            });
            return;
        }
        await route.fulfill({ json: entry.run });
    });

    await trust(page);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    for (const [sql, outcome] of [
        ['INSERT INTO events VALUES (1), (2)', 'INSERT completed · 2 rows written'],
        ['DELETE FROM events WHERE value = 1', 'DELETE completed'],
        ['CREATE TABLE events (value UInt64)', 'CREATE completed'],
    ] as const) {
        await replaceSql(page, sql);
        await page.getByTestId('run-button').click();
        const emptyState = results.locator('.result-empty-state');
        await expect(emptyState).toContainText(outcome);
        await expect(emptyState).toContainText('No result set was returned.');
        await expect(results.getByRole('table', { name: 'Retained query rows' })).toHaveCount(0);
        await expect(results.getByText('This query returned zero rows.')).toHaveCount(0);
    }

    await replaceSql(page, 'SELECT value FROM events WHERE value = 0');
    await page.getByTestId('run-button').click();
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await expect(results.getByText('This query returned zero rows.')).toBeVisible();
});

test('Switching between result and chart views keeps the same execution selected', async ({
    page,
}) => {
    let runs = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') runs++;
    });
    await trust(page);
    await page.getByTestId('run-button').click();
    const results = page.getByRole('region', { name: 'Query results' });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('svg[role="img"]')).toBeVisible();
    await expect(results.getByRole('table')).toHaveCount(0);
    await results.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    expect(runs).toBe(1);
});
