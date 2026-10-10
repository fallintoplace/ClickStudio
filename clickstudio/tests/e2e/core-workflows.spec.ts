import { test, expect, type Page } from '@playwright/test';
import {
    currentQueryId,
    openBlankSql,
    openResultFilter,
    openWorkspacePanel,
    runIdentity,
    runScript,
    runButton,
    trust,
    trustCurrentConnection,
    useAdvancedMode,
} from './helpers.js';

declare global {
    interface Window {
        __nativeParserResult: unknown;
        __parserParseCount?: number;
        __delayNativeParser?: boolean;
        __resolveDelayedNativeParse: () => void;
        __pendingParserFormat?: number;
        __failParserWorker: () => void;
    }
}

async function replaceSql(page: Page, sql: string) {
    const editor = page.locator('.cm-content');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect
        .poll(async () => (await editor.innerText()).replace(/\s/g, ''))
        .toContain(sql.replace(/\s/g, ''));
}

async function runQuery(page: Page) {
    const runResponse = page.waitForResponse(response => {
        const request = response.request();
        return request.method() === 'POST' && new URL(response.url()).pathname === '/api/runs';
    });
    await runButton(page).click();
    const run = runIdentity(await (await runResponse).json());
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', run.queryId);
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    return results;
}

async function mockFailedScriptWithoutRunId(
    page: Page,
    id: string,
    sql: string,
    message = 'Table default.missing_table does not exist.',
) {
    const [failedSql, skippedSql] = sql.split(/;\s*/);
    if (!failedSql || !skippedSql)
        throw new Error('The script fixture must include a statement to skip.');
    const statement = { sql: failedSql, from: 0, to: failedSql.length };
    const skippedStatement = { sql: skippedSql, from: sql.indexOf(skippedSql), to: sql.length };
    const created = {
        id,
        owner: 'local-owner',
        connectionId: 'demo',
        sql,
        createdAt: '2026-09-23T00:00:00.000Z',
        status: 'running',
        stopOnError: true,
        cancelled: false,
        statements: [
            { ...statement, status: 'running' },
            { ...skippedStatement, status: 'pending' },
        ],
    };
    const failed = {
        ...created,
        status: 'failed',
        statements: [
            {
                ...statement,
                status: 'failed',
                error: {
                    code: 'CLICKHOUSE_ERROR',
                    message,
                },
            },
            { ...skippedStatement, status: 'skipped' },
        ],
    };
    const createRoute = (url: URL) => url.pathname === '/api/scripts';
    const pollRoute = (url: URL) => url.pathname === `/api/scripts/${id}`;
    await page.route(createRoute, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fulfill({ status: 202, json: created });
    });
    await page.route(pollRoute, route => route.fulfill({ json: failed }));
    return async () => {
        await page.unroute(createRoute);
        await page.unroute(pollRoute);
    };
}

function parserWorkerStub(initialStatus: 'ready' | 'unavailable', initialResult: unknown = {}) {
    return `(() => {
        const NativeWorker = window.Worker;
        let attempts = 0;
        window.__nativeParserResult = ${JSON.stringify(initialResult)};
        class FakeParserWorker extends EventTarget {
            constructor() {
                super();
                const status = attempts++ === 0 ? ${JSON.stringify(initialStatus)} : 'ready';
                window.__testParserWorker = this;
                queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { kind: 'status', status, reason: 'Temporary parser failure' } })));
            }
            postMessage(request) {
                if (request.kind === 'parseMany') {
                    window.__parserParseCount = (window.__parserParseCount || 0) + 1;
                    const reply = { id: request.id, kind: 'parseMany', ok: true, results: request.sql.map(() => window.__nativeParserResult) };
                    if (window.__delayNativeParser) window.__resolveDelayedNativeParse = () => this.dispatchEvent(new MessageEvent('message', { data: reply }));
                    else queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: reply })));
                }
                else window.__pendingParserFormat = request.id;
            }
            terminate() {}
        }
        window.Worker = new Proxy(NativeWorker, {
            construct(target, args, newTarget) {
                if (String(args[0]).includes('clickhouse-native-parser.worker')) return new FakeParserWorker();
                return Reflect.construct(target, args, newTarget);
            },
        });
        window.__failParserWorker = () => window.__testParserWorker.dispatchEvent(new ErrorEvent('error', { message: 'Temporary parser failure' }));
    })();`;
}

test('Run evidence stays with its draft through tab and mode switches', async ({ page }) => {
    let runRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            runRequests++;
    });
    await trust(page);
    await useAdvancedMode(page);
    await runQuery(page);
    const firstQueryId = await currentQueryId(page);
    const firstResultsPanel = page.locator('.results-surface');
    await firstResultsPanel.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(
        firstResultsPanel.getByRole('tab', { name: 'Chart', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');

    await openBlankSql(page);
    await replaceSql(page, 'SELECT 2 AS second_query');
    const secondResults = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(secondResults.getByRole('table', { name: 'Retained query rows' })).toHaveCount(0);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    await expect(page.locator('.execution-bar')).not.toHaveAttribute('data-query-id');

    await runQuery(page);
    const secondQueryId = await currentQueryId(page);
    expect(secondQueryId).not.toBe(firstQueryId);

    await page.getByRole('tab').filter({ hasText: 'Getting started.sql' }).click();
    await expect(
        firstResultsPanel.getByRole('tab', { name: 'Chart', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(firstResultsPanel.locator('.chart-canvas svg[role="img"]')).toBeVisible();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', firstQueryId);
    await page.getByText('Standard', { exact: true }).click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', firstQueryId);
    await expect(
        firstResultsPanel.getByRole('tab', { name: 'Chart', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.getByText('Experimental', { exact: true }).click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', firstQueryId);
    await expect(page.getByRole('group', { name: 'Workspace layouts' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Workspace browser' })).toBeVisible();
    expect(runRequests).toBe(2);
});

test('Result view and page stay with their draft run', async ({ page }) => {
    const retainedRuns: {
        run: Record<string, unknown>;
        result: Record<string, unknown>;
        rows: unknown[][];
    }[] = [];
    await page.route('**/api/runs**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'POST' && url.pathname === '/api/runs') {
            const input = request.postDataJSON() as {
                connectionId: string;
                sql: string;
                parameters?: Record<string, string>;
                limits?: Record<string, number>;
                tags?: Record<string, string>;
            };
            const runNumber = retainedRuns.length + 1;
            const id = `state-run-${runNumber}`;
            const queryId = `state-query-${runNumber}`;
            const createdAt = new Date(Date.UTC(2026, 0, runNumber)).toISOString();
            const columns = [
                { name: 'label', type: 'String' },
                { name: 'value', type: 'UInt64' },
            ];
            const rows = Array.from({ length: 250 }, (_, index) => [
                `${runNumber}-${index}`,
                index,
            ]);
            const run = {
                dataSource: 'fixture',
                id,
                queryId,
                owner: 'local-owner',
                connectionId: input.connectionId,
                sql: input.sql,
                kind: 'query',
                parameters: input.parameters ?? {},
                limits: input.limits ?? {
                    rows: 5000,
                    bytes: 2000000,
                    seconds: 30,
                    memory: 536870912,
                    threads: 4,
                },
                tags: input.tags ?? {},
                status: 'succeeded',
                createdAt,
                startedAt: createdAt,
                finishedAt: createdAt,
                elapsedMs: 1,
                rowCount: rows.length,
                bytes: rows.length * 8,
                columns,
                warnings: [],
                sequence: runNumber,
                resultExpiresAt: '2027-01-01T00:00:00.000Z',
                resultState: 'reopenable',
                requestedBy: 'local-owner',
                executedAs: 'fixture-reader',
                permissionSnapshot: { readonly: true, role: 'viewer' },
                retryPolicy: 'never',
            };
            const result = {
                runId: id,
                queryId,
                columns,
                rows,
                completeness: 'complete',
                createdAt,
                expiresAt: '2027-01-01T00:00:00.000Z',
            };
            retainedRuns.push({ run, result, rows });
            await route.fulfill({ json: run });
            return;
        }
        if (url.pathname === '/api/runs') {
            await route.fulfill({ json: retainedRuns.map(entry => entry.run) });
            return;
        }
        const match = url.pathname.match(/^\/api\/runs\/(state-run-\d+)(?:\/(snapshot|result))?$/);
        const retained = match && retainedRuns.find(entry => entry.run.id === match[1]);
        if (!retained || !match) {
            await route.fulfill({
                status: 404,
                json: {
                    error: { code: 'RUN_NOT_FOUND', message: 'The mocked run was not found.' },
                },
            });
            return;
        }
        if (match[2] === 'snapshot') {
            await route.fulfill({ json: retained.result });
            return;
        }
        if (match[2] === 'result') {
            const offset = Number(url.searchParams.get('offset') ?? 0);
            const count = Number(url.searchParams.get('count') ?? 200);
            const rows = retained.rows.slice(offset, offset + count);
            await route.fulfill({
                json: {
                    ...retained.result,
                    rows,
                    offset,
                    totalRows: retained.rows.length,
                    nextOffset: offset + count < retained.rows.length ? offset + count : null,
                },
            });
            return;
        }
        await route.fulfill({ json: retained.run });
    });

    await trust(page);
    await useAdvancedMode(page);
    await runQuery(page);
    const firstTab = page
        .getByRole('tablist', { name: 'SQL documents', exact: true })
        .getByRole('tab')
        .first();
    const firstTabName = await firstTab.getAttribute('aria-label');
    const firstResults = page.locator('.results-surface');
    await expect(
        firstResults.getByRole('status', { name: 'Page 1 of 2', exact: true }),
    ).toBeVisible();
    await firstResults.getByRole('button', { name: 'Last page', exact: true }).click();
    await expect(
        firstResults.getByRole('status', { name: 'Page 2 of 2', exact: true }),
    ).toBeVisible();
    await firstResults.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(firstResults.locator('.chart-canvas svg[role="img"]')).toBeVisible();

    await openBlankSql(page);
    await replaceSql(page, 'SELECT 2 AS second_query');
    await runQuery(page);
    await page.getByRole('tab', { name: firstTabName!, exact: true }).click();
    await expect(firstResults.getByRole('tab', { name: 'Chart', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await expect(firstResults.locator('.chart-canvas svg[role="img"]')).toBeVisible();
    await firstResults.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(
        firstResults.getByRole('status', { name: 'Page 2 of 2', exact: true }),
    ).toBeVisible();
});

test('Run button submits the live CodeMirror document before React catches up', async ({
    page,
}) => {
    await trust(page);
    await useAdvancedMode(page);
    const sql = 'SELECT 42 AS button_snapshot';
    await replaceSql(page, 'SELECT 1 AS previous_draft');

    const submitted = page.waitForRequest(
        request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs',
    );
    await page.locator('.cm-content').evaluate((element, currentSql) => {
        const content = element as HTMLElement;
        content.focus();
        document.execCommand('selectAll');
        if (!document.execCommand('insertText', false, currentSql))
            throw new Error('Could not update the CodeMirror document synchronously.');
        content.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'ArrowRight',
                code: 'ArrowRight',
                bubbles: true,
                cancelable: true,
            }),
        );
        const runButton = document.querySelector<HTMLButtonElement>('[data-testid="run-button"]');
        if (!runButton) throw new Error('Run button is missing.');
        runButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }, sql);
    const request = await submitted;
    expect((request.postDataJSON() as { sql: string }).sql).toBe(sql);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
});

test('Selecting text or another statement does not mark existing results as changed', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1;\nSELECT 2;');
    const editor = page.locator('.cm-content');
    const results = page.getByRole('region', { name: 'Query results', exact: true });

    await editor.focus();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.press('Shift+ArrowLeft');
    const submitted = page.waitForRequest(
        request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs',
    );
    await runButton(page).click();
    const originalRequest = await submitted;
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);

    await editor.focus();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+End');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);
    const originalQueryId = await currentQueryId(page);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);
    await replaceSql(page, 'SELECT 1;\nSELECT 3;');
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);
    await replaceSql(page, 'SELECT 4;\nSELECT 3;');
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', originalQueryId);
    await replaceSql(page, 'SELECT 1;\nSELECT 3;');
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Shift+ArrowLeft');
    const next = page.waitForRequest(
        request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs',
    );
    await runButton(page).click();
    expect((await next).postDataJSON().sql).toBe('SELECT 3');
    expect(originalRequest.postDataJSON().sql).toBe('SELECT 1');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);
});

for (const theme of ['Dark', 'Light']) {
    test(`Changed results have no status pill in ${theme.toLowerCase()} mode`, async ({ page }) => {
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        const results = await runQuery(page);
        const queryId = await currentQueryId(page);
        for (const mode of ['Standard', 'Experimental']) {
            await page.getByText(mode, { exact: true }).click();
            await page.setViewportSize({ width: 1440, height: 900 });
            await replaceSql(page, 'SELECT 42');
            await expect(results.locator('.result-provenance-header')).toHaveCount(0);
            await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
            await page.setViewportSize({ width: 390, height: 844 });
            await expect(results.locator('.result-provenance-header')).toHaveCount(0);
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(390);
        }
        await runQuery(page);
        await expect(results.locator('.result-provenance-header')).toHaveCount(0);
    });
}

test('Two Run button clicks in one task submit only one request', async ({ page }) => {
    await trust(page);
    await useAdvancedMode(page);
    await replaceSql(page, 'SELECT 42 AS single_submission');

    let runRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            runRequests++;
    });
    await page.evaluate(() => {
        const runButton = document.querySelector<HTMLButtonElement>('[data-testid="run-button"]');
        if (!runButton) throw new Error('Run button is missing.');
        const click = () =>
            runButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        click();
        click();
    });
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await page.evaluate(
        () =>
            new Promise<void>(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
    );
    expect(runRequests).toBe(1);
});

test('SQL editor keyboard commands do not execute statements or scripts', async ({ page }) => {
    await trust(page);
    await useAdvancedMode(page);
    await replaceSql(page, 'SELECT 42 AS button_only');

    let runRequests = 0,
        scriptRequests = 0;
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && path === '/api/runs') runRequests++;
        if (request.method() === 'POST' && path === '/api/scripts') scriptRequests++;
    });
    await page.locator('.cm-content').evaluate(element => {
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
        for (const shiftKey of [false, true])
            element.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    bubbles: true,
                    cancelable: true,
                    metaKey: isMac,
                    ctrlKey: !isMac,
                    shiftKey,
                }),
            );
    });
    await page.evaluate(
        () =>
            new Promise<void>(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
    );
    expect(runRequests).toBe(0);
    expect(scriptRequests).toBe(0);
});

test('SQL tabs rename by double-click without an F2 command', async ({ page }) => {
    await trust(page);
    await useAdvancedMode(page);
    const tab = page.getByRole('tab', { name: 'Getting started.sql', exact: true });
    await tab.focus();
    await page.keyboard.press('F2');
    await expect(
        page.getByRole('textbox', { name: 'Rename Getting started.sql', exact: true }),
    ).toHaveCount(0);
    await tab.getByText('Getting started.sql', { exact: true }).dblclick();
    await expect(
        page.getByRole('textbox', { name: 'Rename Getting started.sql', exact: true }),
    ).toBeVisible();
});

test('A running query shows its submitted SQL and keeps previous rows until it ends', async ({
    page,
}) => {
    await trust(page);
    await page
        .getByRole('textbox', { name: 'SQL document name', exact: true })
        .fill('Running query.sql');
    const previousRun = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    await runButton(page).click();
    await previousRun;

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const table = results.getByRole('table', { name: 'Retained query rows' });
    await expect(table).toContainText('2026-01-01');
    await expect(results.locator('.result-execution-progress')).toHaveCount(0);

    let releaseRun: () => void = () => {};
    const runGate = new Promise<void>(resolve => {
        releaseRun = resolve;
    });
    let notifyRunRequest: () => void = () => {};
    const runRequest = new Promise<void>(resolve => {
        notifyRunRequest = resolve;
    });
    const runRoute = (url: URL) => url.pathname === '/api/runs';
    await page.route(runRoute, async route => {
        if (route.request().method() === 'POST') {
            notifyRunRequest();
            await runGate;
        }
        await route.continue();
    });
    try {
        const submittedSql = 'SELECT fixture_slow';
        await replaceSql(page, submittedSql);
        await runButton(page).click();
        await runRequest;

        const progress = results.locator('.result-execution-progress');
        await expect(progress).toBeVisible();
        await expect(progress).toContainText(submittedSql);
        await expect(progress.locator('.loading-orbit')).toBeVisible();
        await expect(progress).toContainText('Previous result');
        await expect(table).toContainText('2026-01-01');
        await expect(results.locator('.table-pagination, .result-pagination')).toHaveCount(0);

        await replaceSql(page, "SELECT 'edited after submit' AS value");
        await expect(progress).toContainText(submittedSql);
        await expect(progress).not.toContainText('edited after submit');

        await openBlankSql(page);
        await expect(page.locator('.result-execution-progress')).toHaveCount(0);
        await page.getByRole('tab', { name: 'Running query.sql', exact: true }).click();
        await expect(progress).toBeVisible();

        const startedRun = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/api/runs',
        );
        releaseRun();
        const run = runIdentity(await (await startedRun).json());
        const cancel = runButton(page);
        await expect(cancel).toHaveAttribute('aria-label', 'Cancel');
        await expect(
            page.locator('.execution-bar').getByRole('button', { name: 'Cancel', exact: true }),
        ).toHaveCount(0);
        await expect(cancel).toBeVisible();
        await expect(progress).toBeVisible();
        await expect(table).toContainText('2026-01-01');

        const cancelled = page.waitForResponse(
            response => new URL(response.url()).pathname === `/api/runs/${run.id}/cancel`,
        );
        await cancel.click();
        await cancelled;
        await expect(progress).toHaveCount(0);
    } finally {
        releaseRun();
        await page.unroute(runRoute);
    }
});

test('Restoring a version keeps run status aligned and marks its result as previous', async ({
    page,
}) => {
    await trust(page);
    await useAdvancedMode(page);
    await replaceSql(page, 'SELECT 1 AS version_value;');
    const savePath = (url: URL) => url.pathname === '/api/documents';
    const firstSave = page.waitForResponse(
        response => response.request().method() === 'POST' && savePath(new URL(response.url())),
    );
    await page.getByTestId('save-query').click();
    await firstSave;
    await replaceSql(page, 'SELECT 2 AS version_value;');
    const secondSave = page.waitForResponse(
        response =>
            response.request().method() === 'PUT' &&
            /^\/api\/documents\/[^/]+$/.test(new URL(response.url()).pathname),
    );
    await page.getByTestId('save-query').click();
    await secondSave;

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const table = results.getByRole('table', { name: 'Retained query rows' });
    const firstRun = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    await runButton(page).click();
    await firstRun;
    await expect(table).toContainText('2');

    let runFinished = false;
    let releaseRunStatus: () => void = () => {};
    const runStatusGate = new Promise<void>(resolve => {
        releaseRunStatus = resolve;
    });
    const runCollectionPath = (url: URL) => url.pathname === '/api/runs';
    const runActivityPath = (url: URL) => /^\/api\/runs\/[^/]+(?:\/events)?$/.test(url.pathname);
    await page.route(runCollectionPath, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const response = await route.fetch();
        const run = (await response.json()) as Record<string, unknown>;
        await route.fulfill({ response, json: { ...run, status: 'running' } });
    });
    await page.route(runActivityPath, async route => {
        if (!runFinished) await runStatusGate;
        await route.continue();
    });

    try {
        await replaceSql(page, 'SELECT 3 AS version_value;');
        const pendingRun = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/api/runs',
        );
        await runButton(page).click();
        await pendingRun;
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'running');
        await expect(results.locator('.result-execution-progress')).toContainText('Running');

        await page
            .getByRole('button', { name: 'Version history for Getting started.sql', exact: true })
            .click();
        const versionList = page.locator('.revision-list');
        await expect(versionList.getByRole('button', { name: /Version 1/ })).toBeVisible();
        await versionList.getByRole('button', { name: /Version 1/ }).click();
        await page
            .locator('.revision-preview')
            .getByRole('button', { name: 'Restore', exact: true })
            .click();
        const confirmation = page.getByRole('alertdialog', {
            name: 'Replace your draft with Version 1?',
            exact: true,
        });
        const restoreResponse = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                /\/api\/documents\/[^/]+\/restore-revision$/.test(new URL(response.url()).pathname),
        );
        await confirmation.getByRole('button', { name: 'Restore Version 1', exact: true }).click();
        await restoreResponse;
        await expect(page.locator('.cm-content')).toContainText('SELECT 1 AS version_value;');
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'running');
        await expect(results.locator('.result-execution-progress')).toContainText(
            'Previous result',
        );
        await expect(table).toContainText('2');

        runFinished = true;
        releaseRunStatus();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
            { timeout: 10000 },
        );
        await expect(results.locator('.result-provenance-header')).toHaveCount(0);
    } finally {
        runFinished = true;
        releaseRunStatus();
        await page.unroute(runCollectionPath);
        await page.unroute(runActivityPath);
    }
});

test('The execution indicator clears when run submission fails', async ({ page }) => {
    await trust(page);
    let releaseFailure: () => void = () => {};
    const failureGate = new Promise<void>(resolve => {
        releaseFailure = resolve;
    });
    let notifyRunRequest: () => void = () => {};
    const runRequest = new Promise<void>(resolve => {
        notifyRunRequest = resolve;
    });
    const runRoute = (url: URL) => url.pathname === '/api/runs';
    await page.route(runRoute, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        notifyRunRequest();
        await failureGate;
        await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Temporary run failure' }),
        });
    });
    try {
        const submittedSql = 'SELECT fixture_submit_failure';
        await replaceSql(page, submittedSql);
        await runButton(page).click();
        await runRequest;
        const progress = page.locator('.result-execution-progress');
        await expect(progress).toBeVisible();
        await expect(progress).toContainText(submittedSql);

        releaseFailure();
        await expect(progress).toHaveCount(0);
        await expect(page.getByTestId('query-failure')).toContainText('NETWORK_RESPONSE');
    } finally {
        releaseFailure();
        await page.unroute(runRoute);
    }
});

test('Failed execution replaces visible results and can close, reopen and retry', async ({
    page,
}, testInfo) => {
    await trust(page);
    const results = await runQuery(page);
    const previousSql = await page.locator('.cm-content').innerText();
    let failNextRun = true;
    const runRoute = (url: URL) => url.pathname === '/api/runs';
    await page.route(runRoute, async route => {
        if (route.request().method() === 'POST' && failNextRun) {
            failNextRun = false;
            return route.fulfill({
                status: 400,
                json: {
                    error: {
                        code: 'SYNTAX_ERROR',
                        message: 'Syntax error at position 15',
                        position: 15,
                    },
                },
            });
        }
        await route.continue();
    });
    try {
        await replaceSql(page, 'SELECT * FROM missing_table');
        await runButton(page).click();
        const failure = page.getByTestId('query-failure');
        await expect(failure).toContainText('SYNTAX_ERROR');
        await expect(failure).toContainText('Syntax error at position 15');
        await expect(results.getByRole('heading', { name: 'Output', exact: true })).toBeVisible();
        await expect(results.getByRole('table')).toHaveCount(0);
        await expect(results.locator('.result-provenance-header')).toHaveCount(0);
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'failed');
        await expect(page.locator('.execution-bar')).not.toHaveAttribute('data-query-id');
        await expect(page.locator('.execution-bar')).not.toContainText('Query failed');
        await expect(page.locator('.query-failed-status')).toHaveText('Last execution failed');
        await expect(failure.locator('details')).not.toHaveAttribute('open');
        await page.screenshot({ path: testInfo.outputPath('failed-output.png') });
        await results.getByRole('button', { name: 'Collapse Query results', exact: true }).click();
        await expect(failure).toBeHidden();
        await page.locator('.query-failed-status').click();
        await expect(failure).toBeVisible();
        await results.getByRole('button', { name: 'Close output', exact: true }).click();
        await expect(results).toHaveCount(0);
        await expect(page.locator('.workspace-content')).not.toHaveClass(/has-panel-split|has-run/);
        await expect(page.locator('.cm-content')).toBeFocused();
        await openBlankSql(page);
        await expect(page.locator('.query-failed-status')).toHaveCount(0);
        await page.getByRole('tab').filter({ hasText: 'Getting started.sql' }).click();
        await expect(results).toHaveCount(0);
        await page.locator('.query-failed-status').click();
        await expect(failure).toBeVisible();

        await openWorkspacePanel(page, 'history');
        await page
            .locator('.history-card')
            .filter({ hasText: previousSql.replace(/\s+/g, ' ').slice(0, 58) })
            .first()
            .click();
        await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
        await expect(failure).toHaveCount(0);
        await page.getByRole('tab').filter({ hasText: 'Getting started.sql' }).first().click();
        await page.locator('.query-failed-status').click();
        await expect(failure).toBeVisible();
        await results.getByRole('button', { name: 'Close output', exact: true }).click();
        await replaceSql(page, 'SELECT 1');
        await runQuery(page);
        await expect(failure).toHaveCount(0);
        await expect(page.locator('.query-failed-status')).toHaveCount(0);
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
    } finally {
        await page.unroute(runRoute);
    }
});

test('A query failure in another draft remains discoverable without showing its error in the active draft', async ({
    page,
}) => {
    await trust(page);
    let release = () => {};
    const pending = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route(
        url => url.pathname === '/api/runs',
        async route => {
            if (route.request().method() !== 'POST') return route.continue();
            await pending;
            await route.fulfill({
                status: 400,
                json: { error: { code: 'SYNTAX_ERROR', message: 'Syntax error', position: 0 } },
            });
        },
    );
    await replaceSql(page, 'SELECT broken');
    const request = page.waitForRequest(
        request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs',
    );
    await runButton(page).click();
    await request;
    await openBlankSql(page);
    release();
    await expect(page.locator('.toast-error')).toContainText('Query failed');
    await expect(page.getByTestId('query-failure')).toHaveCount(0);
    await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
    await page.getByRole('tab').filter({ hasText: 'Getting started.sql' }).click();
    await expect(page.getByTestId('query-failure')).toBeVisible();
});

for (const theme of ['Dark', 'Light'])
    for (const mode of ['Standard', 'Experimental']) {
        test(`Failed Output preserves the split in ${theme.toLowerCase()} ${mode} mode`, async ({
            page,
        }, testInfo) => {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await trust(page);
            await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
            await page.getByText(mode, { exact: true }).click();
            const results = await runQuery(page);
            await expect(results.locator('.results-header .result-row-count')).toBeVisible();
            await page.evaluate(() => document.fonts.ready);
            await results.evaluate(async element => {
                await Promise.allSettled(
                    element.getAnimations({ subtree: true }).map(animation => animation.finished),
                );
                await new Promise(requestAnimationFrame);
            });
            const before = (await results.boundingBox())!;
            const runBefore = (await runButton(page).boundingBox())!;
            const saveBefore = (await page.getByTestId('save-query').boundingBox())!;
            const message =
                'Syntax error: failed at position 10 (GROUP) (line 2, col 1): GROUP BY FORMAT JSONCompactStringsEachRowWithNamesAndTypes. Expected one of: token, expression, identifier.';
            await page.route(
                url => url.pathname === '/api/runs',
                async route => {
                    if (route.request().method() === 'POST')
                        return route.fulfill({
                            status: 400,
                            json: { error: { code: 'CLICKHOUSE_62', message } },
                        });
                    await route.continue();
                },
            );
            await replaceSql(page, 'SELECT 1\nGROUP BY');
            await runButton(page).click();
            const failure = results.getByTestId('query-failure');
            await expect(failure).toBeVisible();
            await expect(page.locator('.editor-surface').getByTestId('query-failure')).toHaveCount(
                0,
            );
            const after = (await results.boundingBox())!;
            expect(after.y).toBeCloseTo(before.y, 0);
            expect(after.height).toBeCloseTo(before.height, 0);
            for (const [button, previous] of [
                [runButton(page), runBefore],
                [page.getByTestId('save-query'), saveBefore],
            ] as const) {
                const current = (await button.boundingBox())!;
                expect(current.x).toBeCloseTo(previous.x, 0);
                expect(current.y).toBeCloseTo(previous.y, 0);
                expect(current.width).toBeCloseTo(previous.width, 0);
            }
            await expect(page.locator('.editor-heading-actions .query-failed-status')).toHaveCount(
                0,
            );
            await expect(failure.locator('.result-failure-detail')).toBeHidden();
            await expect(failure.locator('.result-failure-code')).toHaveText('CLICKHOUSE_62');
            await expect(failure.locator('.result-failure-location')).toHaveText(
                'Line 2, column 1',
            );
            await expect(
                failure.locator('.is-context .result-failure-line > span:last-child'),
            ).toHaveText(['SELECT 1', 'GROUP BY\n^']);
            await expect(results.getByRole('table')).toHaveCount(0);
            await expect(results.locator('.result-row-count')).toHaveCount(0);
            await expect(page.locator('.toast-error')).toHaveCount(0);
            await expect(page.locator('.query-failed-status')).toBeVisible();
            await expect(page.locator('.cm-server-error-line')).toContainText('GROUP BY');
            await expect(page.locator('.cm-lint-marker-error')).toBeVisible();
            await page.locator('.cm-content').focus();
            await page.keyboard.press('ControlOrMeta+a');
            await expect(failure).toBeVisible();
            const editorFont = await page.locator('.cm-scroller').evaluate(element => {
                const style = getComputedStyle(element);
                return [style.fontFamily, style.fontSize, style.lineHeight];
            });
            const excerptFont = await failure.locator('.is-context').evaluate(element => {
                const style = getComputedStyle(element);
                return [style.fontFamily, style.fontSize, style.lineHeight];
            });
            expect(excerptFont).toEqual(editorFont);
            await page.screenshot({ path: testInfo.outputPath('error-desktop.png') });
            const details = failure.locator('details');
            await details.locator('summary').focus();
            await page.keyboard.press('Enter');
            await expect(failure.locator('.result-failure-detail')).toBeVisible();
            await expect(failure.locator('.result-failure-detail')).toHaveText(
                `[CLICKHOUSE_62] ${message}`,
            );
            await expect(failure.locator('.is-full')).toHaveText('SELECT 1\nGROUP BY');
            const expanded = (await results.boundingBox())!;
            expect(expanded.y).toBeCloseTo(before.y, 0);
            expect(expanded.height).toBeCloseTo(before.height, 0);
            await page.keyboard.press('Enter');
            await expect(failure.locator('.result-failure-detail')).toBeHidden();
            await page.setViewportSize({ width: 390, height: 844 });
            await expect(failure).toBeVisible();
            await expect(
                results.getByRole('button', { name: 'Close output', exact: true }),
            ).toBeInViewport();
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(390);
            await page.screenshot({ path: testInfo.outputPath('error-mobile.png') });
            await replaceSql(page, 'SELECT 2');
            await expect(failure.locator('.result-failure-location')).toHaveText(
                'Line 2, column 1',
            );
            await expect(
                failure.locator('.is-context .result-failure-line > span:last-child'),
            ).toHaveText(['SELECT 1', 'GROUP BY\n^']);
            await expect(page.locator('.cm-server-error-line')).toHaveCount(0);
        });
    }

for (const theme of ['Dark', 'Light'])
    test(`Long failed SQL stays compact in ${theme.toLowerCase()} Output`, async ({
        page,
    }, testInfo) => {
        await trust(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        const sql = [
            'SELECT',
            '    product_category,',
            '    count() AS reviews',
            'FROM amazon.amazon_reviews',
            "WHERE product_category != ''",
            '    AND star_rating > 0',
            '    AND star_rating <= 5',
            'GROUP BY product_category',
            '-- Keep categories with enough reviews',
            'HAVIsNG reviews >= 100000',
            'ORDER BY reviews DESC',
            'LIMIT 12',
        ].join('\n');
        let message =
            'Syntax error: failed at position 210 (HAVIsNG) (line 10, col 1): HAVIsNG reviews >= 100000 FORMAT JSONCompactStringsEachRowWithNamesAndTypes. Expected one of: token, expression, identifier, HAVING.';
        await page.route(
            url => url.pathname === '/api/runs',
            async route => {
                if (route.request().method() === 'POST')
                    return route.fulfill({
                        status: 400,
                        json: { error: { code: 'CLICKHOUSE_62', message } },
                    });
                await route.continue();
            },
        );
        await replaceSql(page, sql);
        await runButton(page).click();
        const failure = page.getByTestId('query-failure');
        await expect(
            failure.getByRole('heading', { name: 'Syntax error near HAVIsNG' }),
        ).toBeVisible();
        await expect(failure.locator('.is-context .result-failure-line-number')).toHaveText([
            '8',
            '9',
            '10',
            '11',
            '12',
        ]);
        await expect(failure.locator('.is-context')).toContainText('HAVIsNG reviews >= 100000');
        await expect(failure.locator('.is-context')).not.toContainText('FORMAT JSONCompact');
        await expect(failure.locator('.result-failure-detail')).toBeHidden();
        await expect(failure.locator('.is-full')).toBeHidden();
        await expect(failure.locator('summary')).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath('long-error-output.png') });
        await failure.locator('summary').click();
        await expect(failure.locator('.result-failure-detail')).toHaveText(
            `[CLICKHOUSE_62] ${message}`,
        );
        await expect(failure.locator('.is-full')).toHaveText(sql);
        await replaceSql(page, sql.replace('HAVIsNG', 'HAVING'));
        await expect(failure.locator('.is-context')).toContainText('HAVIsNG');
        await expect(failure.locator('details')).toHaveAttribute('open');
        message = 'Syntax error (line 1, col 1): SELECT';
        await runButton(page).click();
        await expect(failure.locator('.result-failure-location')).toHaveText('Line 1, column 1');
        await expect(failure.locator('details')).not.toHaveAttribute('open');
        await expect(failure.locator('.is-context .result-failure-line-number')).toHaveText([
            '1',
            '2',
            '3',
            '4',
            '5',
        ]);
    });

test('A failed saved run shows its submitted error in Output', async ({ page }) => {
    await trust(page);
    let failedRun: Record<string, unknown> | undefined;
    const runRoute = (url: URL) => url.pathname === '/api/runs';
    const runDetailRoute = (url: URL) => /^\/api\/runs\/[^/]+$/.test(url.pathname);
    await page.route(runDetailRoute, async route => {
        if (route.request().method() === 'GET' && failedRun)
            return route.fulfill({ json: failedRun });
        await route.continue();
    });
    await page.route(runRoute, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const response = await route.fetch();
        const run = (await response.json()) as Record<string, unknown>;
        failedRun = {
            ...run,
            status: 'failed',
            resultState: 'unavailable',
            error: {
                code: 'SYNTAX_ERROR',
                message: 'Syntax error at position 15',
                position: Number(run.sourceFrom ?? 0) + 15,
            },
        };
        await route.fulfill({ response, json: failedRun });
    });

    try {
        await replaceSql(page, '\nSELECT * FROM missing_table');
        const submitted = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/api/runs',
        );
        await runButton(page).click();
        await submitted;

        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await expect(page.getByTestId('query-failure')).toContainText('SYNTAX_ERROR');
        await expect(page.getByTestId('query-failure')).toContainText(
            'Syntax error at position 15',
        );
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'failed');
        await expect(results).not.toContainText('No retained result');
        await expect(results.locator('.result-provenance-header')).toHaveCount(0);
        await expect(page.locator('.result-failure-location')).toContainText('Line 2, column 16');
        await page.locator('.cm-content').focus();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Shift+ArrowLeft');
        await expect(page.locator('.result-failure-location')).toContainText('Line 2, column 16');
        await expect(page.locator('.cm-server-error-line')).toContainText(
            'SELECT * FROM missing_table',
        );
        await expect(page.getByRole('button', { name: 'Go to error', exact: true })).toHaveCount(0);
    } finally {
        await page.unroute(runRoute);
        await page.unroute(runDetailRoute);
    }
});

test('Failed output stays docked while editor markers open in a separate window', async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await trust(page);
    await runQuery(page);
    await page.route(
        url => url.pathname === '/api/runs',
        async route => {
            if (route.request().method() === 'POST')
                return route.fulfill({
                    status: 400,
                    json: {
                        error: {
                            code: 'CLICKHOUSE_62',
                            message: 'Syntax error (line 2, col 1): GROUP BY',
                        },
                    },
                });
            await route.continue();
        },
    );
    await replaceSql(page, 'SELECT 1\nGROUP BY');
    await runButton(page).click();
    await expect(page.getByTestId('query-failure')).toBeVisible();
    const editorOpened = page.waitForEvent('popup');
    await page
        .getByRole('button', { name: 'Open editor in a separate window', exact: true })
        .click();
    const editor = await editorOpened;
    await expect(editor.locator('.query-failed-status')).toBeVisible();
    await expect(editor.locator('.cm-server-error-line')).toContainText('GROUP BY');
    await expect(editor.getByTestId('query-failure')).toHaveCount(0);
    await editor.close();
    await expect(page.getByTestId('query-failure')).toBeVisible();
    await expect(page.locator('.is-context .result-failure-line > span:last-child')).toHaveText([
        'SELECT 1',
        'GROUP BY\n^',
    ]);
    await page.locator('.result-failure-diagnostics summary').click();
    await expect(page.locator('.result-failure-detail')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close output', exact: true }).click();
    await expect(page.locator('.results-surface')).toHaveCount(0);
    await page.locator('.query-failed-status').click();
    await expect(page.getByTestId('query-failure')).toBeVisible();
});

test('Run Script shows the full submitted script while submission is pending', async ({ page }) => {
    await trust(page);
    await useAdvancedMode(page);
    const submittedSql = `SELECT '${'x'.repeat(300)}';\nSELECT 2;`;
    await replaceSql(page, submittedSql);

    let releaseScript: () => void = () => {};
    const scriptGate = new Promise<void>(resolve => {
        releaseScript = resolve;
    });
    let notifyScriptRequest: () => void = () => {};
    const scriptRequest = new Promise<void>(resolve => {
        notifyScriptRequest = resolve;
    });
    const scriptRoute = (url: URL) => url.pathname === '/api/scripts';
    await page.route(scriptRoute, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        notifyScriptRequest();
        await scriptGate;
        await route.continue();
    });
    try {
        await runScript(page);
        await scriptRequest;
        const progress = page.locator('.result-execution-progress');
        await expect(progress).toBeVisible();
        await expect(progress.locator('pre.result-execution-sql:not(.is-full)')).not.toContainText(
            'SELECT 2;',
        );
        const fullSql = progress.locator('details');
        await expect(fullSql).toHaveCount(1);
        await fullSql.locator('summary').click();
        await expect(fullSql.locator('pre')).toHaveText(submittedSql);

        const startedScript = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/api/scripts',
        );
        releaseScript();
        await startedScript;
    } finally {
        releaseScript();
        await page.unroute(scriptRoute);
    }
});

test('Query and result panels collapse to their headings', async ({ page }) => {
    await page.setViewportSize({ width: 1905, height: 1280 });
    await trust(page);
    const results = await runQuery(page);
    await page.getByText('Standard', { exact: true }).click();
    const queryPanel = page.locator('.editor-surface');
    const resultsPanel = results;

    await page.locator('button[aria-controls="sql-editor-content"]').click();
    await expect(page.locator('#sql-editor-content')).toBeHidden();
    await expect.poll(async () => (await queryPanel.boundingBox())?.height ?? 0).toBeLessThan(80);
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();

    await page.locator('button[aria-controls="query-results-content"]').click();
    await expect(page.locator('#query-results-content')).toBeHidden();
    await expect.poll(async () => (await resultsPanel.boundingBox())?.height ?? 0).toBeLessThan(80);

    await expect
        .poll(() =>
            page.evaluate(() => {
                const layout = JSON.parse(
                    localStorage.getItem('clickstudio:workspace-layout:v1') ?? 'null',
                ) as { query?: { collapsed?: boolean }; results?: { collapsed?: boolean } } | null;
                return layout?.query?.collapsed === true && layout.results?.collapsed === true;
            }),
        )
        .toBe(true);
    await page.reload();
    await expect(page.locator('#sql-editor-content')).toBeHidden();
    await expect(page.locator('#query-results-content')).toBeHidden();

    await page.locator('button[aria-controls="sql-editor-content"]').click();
    await expect(page.locator('#sql-editor-content')).toBeVisible();
    await page.locator('button[aria-controls="query-results-content"]').click();
    await expect(page.locator('#query-results-content')).toBeVisible();
});

for (const legacyMode of ['floating', 'maximized'])
    test(`Saved ${legacyMode} panels dock without losing SQL, results, or layout preferences`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1400, height: 1000 });
        await trust(page);
        const sql = 'SELECT number AS value FROM numbers(7)';
        await replaceSql(page, sql);
        const results = await runQuery(page);
        const retainedRows = await results
            .getByRole('table', { name: 'Retained query rows' })
            .innerText();
        const queryId = await currentQueryId(page);
        await page.evaluate(
            mode =>
                localStorage.setItem(
                    'clickstudio:workspace-layout:v1',
                    JSON.stringify({
                        version: 1,
                        splitRatio: 0.63,
                        query: {
                            mode,
                            collapsed: true,
                            geometry: { x: 16, y: 34, width: 550, height: 260 },
                        },
                        results: {
                            mode,
                            collapsed: false,
                            geometry: { x: 700, y: 400, width: 600, height: 400 },
                        },
                    }),
                ),
            legacyMode,
        );
        await page.reload();

        await expect(page.locator('#sql-editor-content')).toBeHidden();
        await expect(
            page.locator('.results-surface').getByRole('table', { name: 'Retained query rows' }),
        ).toHaveText(retainedRows, { useInnerText: true });
        await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
        for (const panel of ['.editor-surface', '.results-surface'])
            await expect(page.locator(panel)).not.toHaveClass(/is-floating|is-maximized/);
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const layout = JSON.parse(
                        localStorage.getItem('clickstudio:workspace-layout:v1') ?? '{}',
                    );
                    return {
                        queryMode: layout.query?.mode,
                        resultsMode: layout.results?.mode,
                        queryCollapsed: layout.query?.collapsed,
                        resultsCollapsed: layout.results?.collapsed,
                        splitRatio: layout.splitRatio,
                    };
                }),
            )
            .toEqual({
                queryMode: 'docked',
                resultsMode: 'docked',
                queryCollapsed: true,
                resultsCollapsed: false,
                splitRatio: 0.63,
            });

        await page.locator('button[aria-controls="sql-editor-content"]').click();
        await expect(page.locator('#sql-editor-content .cm-content')).toHaveText(sql);
        await expect(
            page.getByRole('separator', { name: 'Resize query and output panels', exact: true }),
        ).toHaveAttribute('aria-valuenow', '63');
        for (const theme of ['Dark theme', 'Light theme']) {
            await page
                .getByRole('radiogroup', { name: 'Theme' })
                .getByRole('radio', { name: theme })
                .click();
            for (const mode of ['Standard', 'Experimental']) {
                await page.getByText(mode, { exact: true }).click();
                await expect(
                    page.getByRole('button', {
                        name: /^(Float|Maximize|Restore) (query|output) panel$/,
                    }),
                ).toHaveCount(0);
                await expect(
                    page.getByRole('button', {
                        name: 'Open editor in a separate window',
                        exact: true,
                    }),
                ).toBeVisible();
                await expect(
                    page.getByRole('button', {
                        name: 'Open results in a separate window',
                        exact: true,
                    }),
                ).toHaveCount(0);
                await expect(page.locator('.workspace-panel-resize-handle')).toHaveCount(0);
            }
        }
        await page.reload();
        await expect(page.locator('#sql-editor-content .cm-content')).toHaveText(sql);
        await expect(
            page.locator('.results-surface').getByRole('table', { name: 'Retained query rows' }),
        ).toHaveText(retainedRows, { useInnerText: true });
        await expect(
            page.getByRole('separator', { name: 'Resize query and output panels', exact: true }),
        ).toHaveAttribute('aria-valuenow', '63');
    });

for (const mode of ['Standard', 'Experimental'])
    test(`${mode} query opens in a separate window while results stay in the workspace`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1400, height: 1000 });
        await trust(page);
        await page.getByText(mode, { exact: true }).click();
        const results = await runQuery(page);
        const retainedRows = await results
            .getByRole('table', { name: 'Retained query rows' })
            .innerText();
        await page.locator('button[aria-controls="sql-editor-content"]').click();

        const editorPopupPromise = page.waitForEvent('popup');
        await page
            .getByRole('button', { name: 'Open editor in a separate window', exact: true })
            .click();
        const editorPopup = await editorPopupPromise;
        await expect(editorPopup.locator('.cm-content')).toBeVisible();
        await expect(editorPopup.locator('.panel-collapse-button')).toHaveCount(0);
        await expect(editorPopup.locator('.editor-surface')).toHaveCSS('border-radius', '4px');
        await expect(
            editorPopup.getByRole('button', { name: /Float|Maximize|Restore/ }),
        ).toHaveCount(0);
        await expect(page.locator('.detached-query-placeholder-content')).toHaveCount(0);
        await expect(page.locator('.detached-query-location')).toHaveText(
            'Editor open in another window',
        );
        await expect(page.locator('.workspace-panel-splitter')).toHaveCount(0);
        const workspaceBounds = await page.locator('.workspace-content').boundingBox();
        const placeholderBounds = await page.locator('.detached-query-placeholder').boundingBox();
        const outputBounds = await page.locator('.results-surface').boundingBox();
        const headingBounds = await page
            .locator('.detached-query-placeholder .editor-heading')
            .boundingBox();
        const dockBounds = await page
            .locator('.detached-query-placeholder')
            .getByRole('button', { name: 'Dock editor here' })
            .boundingBox();
        expect(workspaceBounds).not.toBeNull();
        expect(headingBounds).not.toBeNull();
        expect(dockBounds).not.toBeNull();
        expect(placeholderBounds?.height).toBeLessThan(80);
        expect(outputBounds?.height).toBeGreaterThan(workspaceBounds!.height * 0.7);
        const headingRight = headingBounds!.x + headingBounds!.width;
        const dockRight = dockBounds!.x + dockBounds!.width;
        expect(headingRight - dockRight).toBeLessThan(24);
        const editedSql = 'SELECT number AS value FROM numbers(3)';
        await replaceSql(editorPopup, editedSql);
        await page
            .getByRole('radiogroup', { name: 'Theme' })
            .getByRole('radio', { name: 'Light theme' })
            .click();
        await expect(editorPopup.locator('html')).toHaveAttribute('data-theme', 'click-light');
        await editorPopup.getByRole('button', { name: 'Dock editor here', exact: true }).click();
        await expect.poll(() => editorPopup.isClosed()).toBe(true);
        await expect(page.locator('.detached-query-placeholder')).toHaveCount(0);
        await expect(page.locator('#sql-editor-content')).toBeHidden();
        await page.locator('button[aria-controls="sql-editor-content"]').click();
        await expect(page.locator('.cm-content')).toHaveText(editedSql);

        await expect(
            page.getByRole('button', { name: 'Open results in a separate window', exact: true }),
        ).toHaveCount(0);
        await expect(
            page.getByRole('separator', { name: 'Resize query and output panels', exact: true }),
        ).toBeVisible();
        await expect(
            page.locator('.results-surface').getByRole('table', { name: 'Retained query rows' }),
        ).toHaveText(retainedRows, { useInnerText: true });
    });

test('Detached beginner editor leaves only a compact workspace header without results', async ({
    page,
}) => {
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'beginner'));
    await page.setViewportSize({ width: 1400, height: 1000 });
    await trust(page);

    const editorPopupPromise = page.waitForEvent('popup');
    await page
        .getByRole('button', { name: 'Open editor in a separate window', exact: true })
        .click();
    const editorPopup = await editorPopupPromise;
    await expect(editorPopup.locator('#sql-editor-content')).toBeVisible();
    await expect(editorPopup.locator('.panel-collapse-button')).toHaveCount(0);
    await expect(page.locator('.detached-query-placeholder-content')).toHaveCount(0);
    await expect(page.locator('.detached-query-location')).toHaveText(
        'Editor open in another window',
    );
    const placeholderBounds = await page.locator('.detached-query-placeholder').boundingBox();
    expect(placeholderBounds?.height).toBeLessThan(80);
});

test('Desktop docked query and output panels resize with the splitter', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await trust(page);
    const results = await runQuery(page);
    const queryPanel = page.locator('.editor-surface');
    const splitter = page.getByRole('separator', {
        name: 'Resize query and output panels',
        exact: true,
    });
    await expect(splitter).toBeVisible();

    const queryBefore = await queryPanel.boundingBox();
    const resultsBefore = await results.boundingBox();
    const splitBox = await splitter.boundingBox();
    expect(queryBefore).not.toBeNull();
    expect(resultsBefore).not.toBeNull();
    expect(splitBox).not.toBeNull();
    expect(splitBox!.height).toBe(10);
    expect(
        Math.abs(splitBox!.y + splitBox!.height / 2 - (queryBefore!.y + queryBefore!.height)),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(resultsBefore!.y - (queryBefore!.y + queryBefore!.height))).toBeLessThanOrEqual(
        1,
    );
    for (const offset of [1, 5, 9]) {
        expect(
            await page.evaluate(
                ({ x, y }) =>
                    Boolean(document.elementFromPoint(x, y)?.closest('.workspace-panel-splitter')),
                {
                    x: splitBox!.x + splitBox!.width / 2,
                    y: splitBox!.y + offset,
                },
            ),
        ).toBe(true);
    }

    await page.mouse.move(splitBox!.x + splitBox!.width / 2, splitBox!.y + splitBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(splitBox!.x + splitBox!.width / 2, splitBox!.y + 100, { steps: 5 });
    await page.mouse.up();

    const queryAfter = await queryPanel.boundingBox();
    const resultsAfter = await results.boundingBox();
    const splitAfter = await splitter.boundingBox();
    expect(queryAfter).not.toBeNull();
    expect(resultsAfter).not.toBeNull();
    expect(splitAfter).not.toBeNull();
    expect(queryAfter!.height).toBeGreaterThan(queryBefore!.height + 45);
    expect(resultsAfter!.height).toBeLessThan(resultsBefore!.height - 45);
    expect(
        Math.abs(splitAfter!.y + splitAfter!.height / 2 - (queryAfter!.y + queryAfter!.height)),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(resultsAfter!.y - (queryAfter!.y + queryAfter!.height))).toBeLessThanOrEqual(1);
    expect(Math.abs(queryAfter!.y + queryAfter!.height - (splitBox!.y + 100))).toBeLessThanOrEqual(
        1,
    );

    const ratioBeforeKeyboard = Number(await splitter.getAttribute('aria-valuenow'));
    await splitter.press('ArrowUp');
    const expectedRatio = String(Math.max(25, ratioBeforeKeyboard - 5));
    await expect(splitter).toHaveAttribute('aria-valuenow', expectedRatio);
    await page.reload();
    await expect(splitter).toHaveAttribute('aria-valuenow', expectedRatio);
    await expect(
        page.locator('.results-surface').getByRole('table', { name: 'Retained query rows' }),
    ).toBeVisible();
});

test('Native parser can be retried after a temporary worker failure', async ({ page }) => {
    await page.addInitScript(parserWorkerStub('unavailable'));
    await trust(page);
    const retry = page.getByRole('button', { name: 'Retry parser', exact: true });
    await expect(retry).toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    const header = page.locator('.editor-heading');
    const bounds = await header.boundingBox();
    expect(bounds).not.toBeNull();
    for (const button of [
        retry,
        page.getByTestId('format-sql'),
        page.getByTestId('save-query'),
        runButton(page),
    ]) {
        await expect(button).toBeVisible();
        const buttonBounds = await button.boundingBox();
        expect(buttonBounds).not.toBeNull();
        expect(buttonBounds!.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(buttonBounds!.x + buttonBounds!.width).toBeLessThanOrEqual(
            bounds!.x + bounds!.width,
        );
        await button.click({ trial: true });
    }
    await retry.click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspacePanel(page, 'parser');
    await expect(page.getByText('Ready · local WebAssembly', { exact: true })).toBeVisible();
    await expect
        .poll(() => page.evaluate(() => Number(window.__parserParseCount ?? 0)))
        .toBeGreaterThan(0);
});

test('Experimental parser inspector shows native AST, UTF-8 semantic highlights, and expected tokens', async ({
    page,
}) => {
    const sql = "SELECT '🙂', uniqExact(user_id) FROM events";
    const functionPrefix = "SELECT '🙂', ";
    const parserResponse = {
        ast: { type: 'SelectWithUnionQuery', children: [{ type: 'SelectQuery' }] },
        highlights: [
            {
                begin: new TextEncoder().encode(functionPrefix).length,
                end: new TextEncoder().encode(functionPrefix + 'uniqExact').length,
                type: 'function',
            },
            {
                begin: new TextEncoder().encode(functionPrefix + 'uniqExact(').length,
                end: new TextEncoder().encode(functionPrefix + 'uniqExact(user_id').length,
                type: 'identifier',
            },
        ],
    };
    await page.addInitScript(parserWorkerStub('ready', parserResponse));
    await page.goto('/');
    await replaceSql(page, sql);
    await expect(page.locator('.cm-native-function')).toHaveText('uniqExact');

    await openWorkspacePanel(page, 'parser');
    await expect(page.getByText('SelectWithUnionQuery', { exact: true })).toBeVisible();
    await page.getByText('View native AST', { exact: true }).click();
    await expect(page.getByText(/"type": "SelectWithUnionQuery"/)).toBeVisible();

    const invalidSql = 'SELECT 1 +';
    await page.evaluate(() => {
        window.__nativeParserResult = {
            error: {
                message: 'Syntax error',
                begin: 10,
                end: 10,
                expected: ['FROM', 'WHERE', 'GROUP BY'],
            },
        };
    });
    await replaceSql(page, invalidSql);
    await expect(page.getByText('Syntax error', { exact: true })).toBeVisible();
    await expect(page.getByText('GROUP BY', { exact: true })).toBeVisible();
});

test('SQL structure switches from logical flow to native AST', async ({ page }) => {
    const parserResponse = {
        ast: {
            type: 'SelectWithUnionQuery',
            union_mode: 'UNION_DEFAULT',
            list_of_selects: {
                type: 'ExpressionList',
                children: [
                    {
                        type: 'SelectQuery',
                        select: {
                            type: 'ExpressionList',
                            children: [
                                {
                                    type: 'Function',
                                    name: 'uniqExact',
                                    arguments: {
                                        type: 'ExpressionList',
                                        children: [{ type: 'Identifier', name: 'user_id' }],
                                    },
                                },
                            ],
                        },
                        tables: {
                            type: 'TablesInSelectQuery',
                            children: [
                                { type: 'TableIdentifier', name_parts: ['analytics', 'events'] },
                            ],
                        },
                    },
                ],
            },
        },
        highlights: [],
    };
    await page.addInitScript(parserWorkerStub('ready', parserResponse));
    await trust(page);
    await replaceSql(page, 'SELECT uniqExact(user_id) FROM analytics.events');

    await runButton(page).click();
    await page.getByRole('tab', { name: 'SQL map', exact: true }).click();
    const structure = page.locator('.sql-flow-view');
    const flow = structure.getByRole('button', { name: 'Logical flow', exact: true });
    const nativeAst = structure.getByRole('button', { name: 'Native AST', exact: true });
    await expect(flow).toHaveAttribute('aria-pressed', 'true');
    await expect(structure.locator('.pipeline-node-face').first()).toHaveCSS('rx', '4px');
    await expect(structure.locator('.pipeline-node-shadow').first()).toHaveCSS('rx', '4px');
    await expect(nativeAst).toBeEnabled();
    await expect(structure.locator('.sql-flow-heading p')).toHaveText(
        'Click a stage to jump to its SQL.',
    );
    await expect(structure.locator('.sql-flow-heading')).not.toContainText(
        'not a server execution plan',
    );
    const headingHeight = await structure
        .locator('.sql-flow-heading')
        .evaluate(element => element.getBoundingClientRect().height);
    expect(headingHeight).toBeLessThan(64);

    await nativeAst.click();
    await expect(nativeAst).toHaveAttribute('aria-pressed', 'true');
    await expect(structure.locator('.sql-flow-heading p')).toHaveText(
        'Select a node to inspect its parser fields.',
    );
    await expect(structure.locator('.sql-flow-heading')).not.toContainText('server execution plan');
    await expect(structure.locator('[data-ast-node-type="SelectWithUnionQuery"]')).toBeVisible();
    await expect(structure.locator('.ast-graph-node rect').first()).toHaveCSS('rx', '4px');
    const selectList = structure.locator(
        '[data-ast-node-path="$.list_of_selects.children[0].select"]',
    );
    await expect(selectList).toBeVisible();
    await selectList.dblclick();

    const fn = structure.locator('[data-ast-node-type="Function"]');
    await expect(fn).toBeVisible();
    await fn.click();
    await expect(structure.locator('.ast-node-inspector')).toContainText('uniqExact');
    await structure.locator('[data-ast-node-type="SelectWithUnionQuery"]').click();
    await fn.press('Enter');
    await expect(structure.locator('.ast-node-inspector')).toContainText('uniqExact');
    await structure.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(structure.getByLabel('Zoom level', { exact: true })).toHaveText('120%');
    await flow.click();
    await expect(structure.locator('[data-ast-node-type]')).toHaveCount(0);
    await nativeAst.click();
    await expect(structure.getByLabel('Zoom level', { exact: true })).toHaveText('100%');
    await expect(structure.locator('.ast-node-inspector strong').first()).toContainText(
        'SelectWithUnionQuery',
    );
});

test('SQL structure loads the server analyzer tree', async ({ page }) => {
    await trust(page);
    await replaceSql(
        page,
        'SELECT event_type, count() AS events FROM demo.events GROUP BY event_type',
    );
    await runButton(page).click();
    await page.getByRole('tab', { name: 'SQL map', exact: true }).click();
    const structure = page.locator('.sql-flow-view');
    const analyzer = structure.getByRole('button', { name: 'Analyzer', exact: true });
    await expect(analyzer).toBeEnabled();
    await analyzer.click();
    await expect(analyzer).toHaveAttribute('aria-pressed', 'true');
    await expect(structure.locator('.sql-flow-heading p')).toHaveText(
        'Select a node to inspect resolved analyzer fields.',
    );
    await expect(structure.locator('[data-query-tree-type="QUERY"]')).toBeVisible();
    await expect(structure.locator('.ast-graph-node rect').first()).toHaveCSS('rx', '4px');
    const table = structure.locator('[data-query-tree-type="TABLE"]');
    await expect(table).toContainText('demo.events');
    await table.click();
    await expect(structure.locator('.query-tree-node-inspector')).toContainText('demo.events');
    await structure.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(structure.getByLabel('Zoom level', { exact: true })).toHaveText('120%');
    await structure.getByRole('button', { name: 'Logical flow', exact: true }).click();
    await analyzer.click();
    await expect(structure.getByLabel('Zoom level', { exact: true })).toHaveText('120%');
    await expect(structure.locator('.query-tree-node-inspector')).toContainText('demo.events');
});

test('A delayed native parse cannot replace parser details for newer SQL', async ({ page }) => {
    const oldSql = 'SELECT old_fn()';
    const newSql = 'SELECT new_fn()';
    const oldResult = {
        ast: { type: 'OldStatement' },
        highlights: [{ begin: 7, end: 13, type: 'function' }],
    };
    await page.addInitScript(parserWorkerStub('ready', oldResult));
    await page.goto('/');
    await expect
        .poll(() => page.evaluate(() => Number(window.__parserParseCount ?? 0)))
        .toBeGreaterThan(0);

    await page.evaluate(() => {
        window.__delayNativeParser = true;
    });
    await replaceSql(page, oldSql);
    await expect
        .poll(() => page.evaluate(() => Boolean(window.__resolveDelayedNativeParse)))
        .toBe(true);
    await page.evaluate(() => {
        window.__nativeParserResult = {
            ast: { type: 'NewStatement' },
            highlights: [{ begin: 7, end: 13, type: 'function' }],
        };
        window.__delayNativeParser = false;
    });
    await replaceSql(page, newSql);
    await expect(page.locator('.cm-native-function')).toHaveText('new_fn');
    await openWorkspacePanel(page, 'parser');
    await expect(page.getByText('NewStatement', { exact: true })).toBeVisible();

    await page.evaluate(() => window.__resolveDelayedNativeParse());
    await expect(page.getByText('NewStatement', { exact: true })).toBeVisible();
    await expect(page.getByText('OldStatement', { exact: true })).toHaveCount(0);
});

test('Failed async formatting does not overwrite edits typed while it was pending', async ({
    page,
}) => {
    await page.addInitScript(parserWorkerStub('ready'));
    await trust(page);
    await replaceSql(page, 'select old_value from old_table');
    await openWorkspacePanel(page, 'parser');
    await expect(page.getByText('Ready · local WebAssembly', { exact: true })).toBeVisible();
    await page.getByTestId('format-sql').click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__pendingParserFormat))).toBe(true);
    await replaceSql(page, 'select new_value from new_table');
    await page.evaluate(() => window.__failParserWorker());
    await expect(page.locator('.cm-content')).toContainText('new_value');
    await expect(page.locator('.cm-content')).not.toContainText('old_value');
});

test('Experimental formatting preserves SQL comments when native formatting falls back', async ({
    page,
}) => {
    await page.addInitScript(parserWorkerStub('ready'));
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'expert'));
    await page.goto('/');
    await replaceSql(page, '-- keep this comment\nselect 1 as value from numbers(1)');
    await expect
        .poll(() => page.evaluate(() => Number(window.__parserParseCount ?? 0)))
        .toBeGreaterThan(0);
    await openWorkspacePanel(page, 'parser');
    await expect(page.getByText('Ready · local WebAssembly', { exact: true })).toBeVisible();
    await page.getByTestId('format-sql').click();
    await expect(page.locator('.cm-content .cm-line')).toHaveText([
        '-- keep this comment',
        'select 1 as value',
        'FROM numbers(1)',
    ]);
});

test('Connection switches keep run evidence isolated and recover each connection workspace', async ({
    page,
}) => {
    await trust(page);
    await runQuery(page);
    const firstQueryId = await currentQueryId(page);

    const picker = page.locator('.connection-trigger');
    await picker.click();
    await page
        .getByRole('dialog', { name: 'Connection details' })
        .getByRole('button', { name: /Another sample/ })
        .click();
    await expect.poll(() => new URL(page.url()).searchParams.get('connection')).toBe('demo-second');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'ready');
    await expect(page.locator('.execution-bar')).not.toHaveAttribute('data-query-id');
    await expect(
        page
            .getByRole('region', { name: 'Query results', exact: true })
            .getByRole('table', { name: 'Retained query rows' }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.connection-trigger')).toContainText('Another sample');
    await trustCurrentConnection(page);
    await runQuery(page);
    const secondQueryId = await currentQueryId(page);
    expect(secondQueryId).not.toBe(firstQueryId);

    await picker.click();
    await page
        .getByRole('dialog', { name: 'Connection details' })
        .getByRole('button', { name: /Sample data/ })
        .click();
    await expect.poll(() => new URL(page.url()).searchParams.get('connection')).toBe('demo');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', firstQueryId);
});

test('Insights compare one run with its ClickHouse pipeline evidence', async ({ page }) => {
    await trust(page);
    const startedRunResponse = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    const results = await runQuery(page);
    const startedRun = runIdentity(await (await startedRunResponse).json());
    const queryPlan = page.getByRole('region', { name: 'Run and query plan comparison' });

    await results.getByRole('tab', { name: 'Insights', exact: true }).click();
    await expect(queryPlan).toContainText(startedRun.queryId);
    const pipelineRequest = page.waitForRequest(
        request =>
            new URL(request.url()).pathname === `/api/runs/${startedRun.id}/profile/pipeline`,
    );
    await queryPlan.getByRole('button', { name: 'Load ClickHouse pipeline', exact: true }).click();
    await pipelineRequest;
    await expect(queryPlan).toContainText('EXPLAIN PIPELINE');
    await expect(queryPlan).toContainText('ReadFromFixture');
    const graph = queryPlan.getByRole('region', { name: 'Scrollable operator graph' });
    await expect(graph.locator('[data-node-id]').filter({ hasText: 'Resize 2 → 1' })).toBeVisible();
    await graph.locator('[data-node-id]').filter({ hasText: 'Resize 2 → 1' }).click();
    await expect(queryPlan.locator('.pipeline-node-inspector')).toContainText('Resize 2 → 1');
    await expect(page.locator('.execution-bar')).toHaveAttribute(
        'data-query-id',
        startedRun.queryId,
    );
});

test('Refreshing a pipeline selects the first operator in the new graph', async ({ page }) => {
    let refreshCount = 0;
    await page.route(
        url => url.pathname.endsWith('/profile/pipeline'),
        async route => {
            refreshCount++;
            const label = refreshCount === 1 ? 'First' : 'Next';
            await route.fulfill({
                json: {
                    available: true,
                    source: 'explain_pipeline',
                    notice: 'Fixture pipeline',
                    nodes: [
                        { id: 'source', label: `${label} reader`, kind: 'read', status: 'planned' },
                        {
                            id: 'output',
                            label: `${label} output`,
                            kind: 'output',
                            status: 'planned',
                        },
                    ],
                    edges: [{ source: 'source', target: 'output' }],
                },
            });
        },
    );
    await trust(page);
    await useAdvancedMode(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Insights', exact: true }).click();
    const section = page.getByRole('region', { name: 'Run and query plan comparison' });
    const load = section.getByRole('button', { name: 'Load ClickHouse pipeline', exact: true });
    await expect(load).toBeEnabled();
    const firstLoad = page.waitForResponse(response =>
        response.url().includes('/profile/pipeline'),
    );
    await load.click();
    await firstLoad;
    const graph = section.getByRole('region', { name: 'Scrollable operator graph' });
    await graph.locator('[data-node-id="output"]').click();
    await expect(section.locator('.pipeline-node-inspector')).toContainText('First output');

    const refresh = section.getByRole('button', { name: 'Refresh pipeline', exact: true });
    const refreshed = page.waitForResponse(response =>
        response.url().includes('/profile/pipeline'),
    );
    await refresh.click();
    await refreshed;
    await expect(section.locator('.pipeline-node-inspector')).toContainText('Next reader');
    await expect(graph.locator('[data-node-id="source"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(graph.locator('[data-node-id="output"]')).toHaveAttribute('aria-pressed', 'false');
});

test('Result filtering searches only the visible retained page without mutating the run', async ({
    page,
}) => {
    await trust(page);
    const results = await runQuery(page);
    const queryId = await currentQueryId(page);
    const rows = results.locator('tbody tr');
    const filter = await openResultFilter(results);
    await expect(rows).toHaveCount(7);

    await filter.fill('2026-01-02');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('2026-01-02');
    await expect(results.locator('.results-header .result-row-count')).toHaveText('1 of 7 rows');
    await filter.fill('no matching value');
    await expect(rows).toHaveCount(0);
    await expect(results).toContainText('No rows match on this page.');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
});

test('SQL and parameter edits keep old results without a status pill', async ({ page }) => {
    let runRequests = 0;
    let submittedSql = '';
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') {
            runRequests++;
            submittedSql = (request.postDataJSON() as { sql: string }).sql;
        }
    });
    await trust(page);
    await useAdvancedMode(page);
    const results = await runQuery(page);
    const queryId = await currentQueryId(page);

    await replaceSql(page, 'SELECT 42');
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    await replaceSql(page, submittedSql);
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);

    await replaceSql(page, 'SELECT {threshold:UInt64}');
    await page
        .getByRole('textbox', { name: 'threshold:UInt64', exact: true })
        .fill('9007199254740993');
    await runQuery(page);
    const parameterRunId = await currentQueryId(page);
    await page
        .getByRole('textbox', { name: 'threshold:UInt64', exact: true })
        .fill('9007199254740994');
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', parameterRunId);
    expect(runRequests).toBe(2);
});

test('Charts keep NULL missing and plot nullable negative values from zero', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({
            response,
            json: {
                ...result,
                columns: [
                    { name: 'label', type: 'String' },
                    { name: 'value', type: 'Nullable(Int64)' },
                ],
                rows: [
                    ['negative', -6],
                    ['missing', null],
                    ['positive', 4],
                ],
                totalRows: 3,
            },
        });
    });
    await trust(page);
    await useAdvancedMode(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-canvas svg[role="img"]')).toBeVisible();
    await results.getByRole('button', { name: 'Measures', exact: true }).click();
    const measure = results.getByRole('group', { name: 'Measures' }).getByLabel('value');
    await expect(measure).toBeChecked();
    await expect(results.locator('.chart-footer')).toContainText(
        '3 retained rows across 1 measure',
    );
    const bars = results.locator('.chart-bar');
    await expect(bars).toHaveCount(2);
    expect(Number(await bars.nth(0).getAttribute('y'))).toBeCloseTo(100, 0);
    expect(Number(await bars.nth(1).getAttribute('y'))).toBeCloseTo(40, 0);
    await expect(results.locator('.chart-zero-line')).toHaveAttribute('y1', '100');
});

test('Categorical charts show every retained row with a full x-axis label', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({
            response,
            json: {
                ...result,
                columns: [
                    { name: 'label', type: 'String' },
                    { name: 'value', type: 'Int64' },
                ],
                rows: Array.from({ length: 350 }, (_, index) => [
                    `row-${index + 1}`,
                    index === 349 ? 1000000 : 1,
                ]),
                completeness: 'complete',
            },
        });
    });
    await trust(page);
    await useAdvancedMode(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-bar')).toHaveCount(350);
    await expect(results.locator('.chart-footer')).toContainText(
        '350 retained rows across 1 measure',
    );
    await expect(results.locator('.chart-x-labels text')).toHaveCount(350);
    await expect(results.locator('.chart-x-labels text').first()).toHaveText('row-1');
    await expect(results.locator('.chart-x-labels text').last()).toHaveText('row-350');
    expect(Number(await results.locator('.chart-bar').last().getAttribute('y'))).toBeCloseTo(40, 0);
});

test('Single-row numeric results render as a number and expose supported chart types', async ({
    page,
}) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({
            response,
            json: {
                ...result,
                columns: [{ name: 'event_count', type: 'UInt64' }],
                rows: [['42']],
                completeness: 'complete',
            },
        });
    });
    await trust(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-number-card')).toContainText('42');
    await expect(results.locator('.result-table-toolbar')).toHaveCount(0);
    await expect(results.locator('.results-table-tools')).toBeEmpty();
    await expect(results.getByLabel('Type').locator('option')).toHaveText([
        'Number',
        'Line',
        'Bar',
        'Scatter',
        'Heatmap',
        'Candlestick',
    ]);
});

test('Scatter charts plot the selected numeric axes', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({
            response,
            json: {
                ...result,
                columns: [
                    { name: 'distance', type: 'Float64' },
                    { name: 'fare', type: 'Float64' },
                ],
                rows: [
                    [1.2, 8.5],
                    [2.4, 12],
                    [5.1, 19.75],
                ],
                completeness: 'complete',
            },
        });
    });
    await trust(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await results.getByLabel('Type').selectOption('scatter');
    await expect(results.locator('.chart-canvas svg[role="img"]')).toHaveAttribute(
        'aria-label',
        /scatter chart/,
    );
    await expect(results.locator('.chart-point')).toHaveCount(3);
    await expect(results.getByLabel('X measure').locator('option:enabled')).toHaveCount(1);
    await expect(results.locator('.chart-footer')).toContainText('3 plotted points');
});

test('Heatmaps retain observed groups and leave missing cells blank', async ({ page }) => {
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        await route.fulfill({
            response,
            json: {
                ...result,
                columns: [
                    { name: 'weekday', type: 'String' },
                    { name: 'hour', type: 'DateTime' },
                    { name: 'trips', type: 'UInt64' },
                ],
                rows: [
                    ['Mon', '2026-09-21 00:00:00', 5],
                    ['Mon', '2026-09-21 01:00:00', 8],
                    ['Tue', '2026-09-21 00:00:00', 3],
                ],
                completeness: 'complete',
            },
        });
    });
    await trust(page);
    const results = await runQuery(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await results.getByLabel('Type').selectOption('heatmap');
    await expect(results.locator('.heatmap-grid')).toBeVisible();
    await expect(
        results.locator('.heatmap-cell[aria-label="Tue, 2026-09-21 01:00:00: no returned row"]'),
    ).toBeVisible();
    await expect(results.locator('.heatmap-caption')).toContainText(
        'blank cells had no returned group',
    );
});

test('A delayed chart snapshot cannot update the draft after selecting another script result', async ({
    page,
}) => {
    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>(resolve => {
        releaseSnapshot = resolve;
    });
    let notifySnapshotStarted!: () => void;
    const snapshotStarted = new Promise<void>(resolve => {
        notifySnapshotStarted = resolve;
    });
    let notifySnapshotFinished!: () => void;
    const snapshotFinished = new Promise<void>(resolve => {
        notifySnapshotFinished = resolve;
    });
    let savePayload: Record<string, unknown> | undefined;
    await page.route('**/api/runs/*/snapshot', async route => {
        const response = await route.fetch();
        const result = await response.json();
        notifySnapshotStarted();
        await snapshotGate;
        await route.fulfill({
            response,
            json: {
                ...result,
                columns: [{ name: 'value', type: 'UInt64' }],
                rows: [['42']],
                completeness: 'complete',
            },
        });
        notifySnapshotFinished();
    });
    await page.route(
        url => url.pathname === '/api/documents',
        async route => {
            if (route.request().method() !== 'POST') return route.continue();
            savePayload = route.request().postDataJSON() as Record<string, unknown>;
            await route.continue();
        },
    );
    try {
        await trust(page);
        await useAdvancedMode(page);
        await replaceSql(page, 'SELECT 1; SELECT 2;');
        await runScript(page);
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        const first = results.getByRole('button', { name: 'Statement 1: succeeded', exact: true });
        const second = results.getByRole('button', { name: 'Statement 2: succeeded', exact: true });
        await expect(first).toBeVisible();
        await expect(second).toBeVisible();
        await first.click();
        await results.getByRole('tab', { name: 'Chart', exact: true }).click();
        await snapshotStarted;
        await results.getByRole('tab', { name: 'Results', exact: true }).click();
        await second.click();
        await expect(second).toHaveAttribute('aria-pressed', 'true');
        releaseSnapshot();
        await snapshotFinished;
        await page.getByTestId('save-query').click();
        await expect.poll(() => savePayload).toBeDefined();
        expect((savePayload?.chart as { kind: string }).kind).toBe('table');
    } finally {
        releaseSnapshot();
    }
});

test('Refreshing run history replaces the visible list with the latest response', async ({
    page,
}) => {
    let refreshed = false;
    const run = {
        id: 'history-refresh-run',
        status: 'succeeded',
        sql: 'SELECT refreshed_history_entry',
        createdAt: '2026-09-23T00:00:00.000Z',
        elapsedMs: 12,
        rowCount: 7,
    };
    await page.route(/\/api\/runs\?connectionId=demo$/, route =>
        route.fulfill({ json: refreshed ? [run] : [] }),
    );
    await trust(page);
    await openWorkspacePanel(page, 'history');
    await expect(page.getByText('No runs yet')).toBeVisible();
    refreshed = true;
    await page.getByRole('button', { name: /Refresh/ }).click();
    await expect(page.getByText('SELECT refreshed_history_entry')).toBeVisible();
});

test('Ask AI keeps chat history when SQL changes and sends prior messages with follow-ups', async ({
    page,
}) => {
    const requests: Array<Record<string, unknown>> = [];
    await page.route('**/api/assistant/sql', async route => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        requests.push(body);
        await route.fulfill({
            json: {
                id: `answer-${requests.length}`,
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-23T00:00:00.000Z',
                baseSql: String(body.sql ?? ''),
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: [],
                decision: 'pending',
                sql: null,
                summary: `Answer to ${String(body.question ?? '')}`,
                assumptions: [],
                tables: [],
                caveats: [],
                clarification: null,
                findings: [],
            },
        });
    });
    await trust(page);
    await useAdvancedMode(page);
    await runQuery(page);
    await page.getByTestId('open-ai').click();
    const question = page.getByRole('textbox', { name: 'Ask AI', exact: true });
    await question.fill('Show the old question');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Answer to Show the old question', { exact: true })).toBeVisible();
    await expect(question).toBeInViewport();

    await replaceSql(page, 'SELECT 2');
    await expect(page.getByText('Answer to Show the old question', { exact: true })).toBeVisible();
    await question.fill('And now?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Answer to And now?', { exact: true })).toBeVisible();

    expect(requests[0]?.includeRun).toBe(true);
    expect(requests[0]?.result).toBeTruthy();
    expect(requests[1]?.sql).toBe('SELECT 2');
    const previousTurn = JSON.parse(
        (requests[1]?.conversation as Array<{ role: string; content: string }>)[0]?.content ?? '{}',
    ) as Record<string, unknown>;
    expect(previousTurn).toMatchObject({
        question: 'Show the old question',
        sql: requests[0]?.sql,
        includeRun: true,
        runId: requests[0]?.runId,
        runContext: { result: requests[0]?.result, evidenceSql: requests[0]?.evidenceSql },
    });
    expect(requests[1]?.conversation).toMatchObject([
        { role: 'user' },
        {
            role: 'assistant',
            content: JSON.stringify({
                summary: 'Answer to Show the old question',
                clarification: null,
                sql: null,
                alternatives: [],
                assumptions: [],
                tables: [],
                caveats: [],
                findings: [],
                decision: 'pending',
            }),
        },
    ]);

    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(page.locator('.assistant-empty-chat')).toBeVisible();
    await expect(page.getByText('Answer to Show the old question', { exact: true })).toHaveCount(0);
    const chatHistory = page.getByRole('button', { name: 'Chat history: New chat', exact: true });
    await chatHistory.click();
    await page.getByRole('button', { name: 'Show the old question', exact: true }).click();
    await expect(page.getByText('Answer to Show the old question', { exact: true })).toBeVisible();
    await expect(page.getByText('Answer to And now?', { exact: true })).toBeVisible();
    await page
        .getByRole('button', { name: 'Chat history: Show the old question', exact: true })
        .click();
    await page
        .getByRole('button', { name: 'Actions for Show the old question', exact: true })
        .click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    const conversationName = page.getByRole('textbox', {
        name: 'New name for Show the old question',
        exact: true,
    });
    await conversationName.fill('Flight delay analysis');
    await page.getByRole('button', { name: 'Save conversation name', exact: true }).click();
    await expect(
        page.getByRole('button', { name: 'Chat history: Flight delay analysis', exact: true }),
    ).toBeVisible();
    const chatHistoryPanel = page.getByRole('region', { name: 'Chat history', exact: true });
    await chatHistoryPanel.getByRole('button', { name: 'New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Chat history: New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Flight delay analysis', exact: true }).click();
    await expect(page.getByText('Answer to Show the old question', { exact: true })).toBeVisible();
    await expect(
        page.getByRole('region', { name: 'Conversation: Flight delay analysis' }),
    ).toBeVisible();
    await page
        .getByRole('button', { name: 'Chat history: Flight delay analysis', exact: true })
        .click();
    await page
        .getByRole('button', { name: 'Actions for Flight delay analysis', exact: true })
        .click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteConfirmation = page.getByRole('alertdialog', {
        name: 'Delete this conversation?',
        exact: true,
    });
    await expect(deleteConfirmation).toBeVisible();
    await deleteConfirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(deleteConfirmation).toHaveCount(0);
    await expect(
        page.getByRole('region', { name: 'Conversation: Flight delay analysis', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(deleteConfirmation).toBeVisible();
    await deleteConfirmation
        .getByRole('button', { name: 'Delete conversation', exact: true })
        .click();
    await expect(page.locator('.assistant-empty-chat')).toBeVisible();
});

test('Ask AI renders answer lists, emphasis, and safe links as Markdown', async ({ page }) => {
    await page.route('**/api/assistant/sql', async route => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
            json: {
                id: 'markdown-answer',
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-23T00:00:00.000Z',
                baseSql: String(body.sql ?? ''),
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: [],
                decision: 'pending',
                sql: null,
                summary:
                    'A short ranking:\n\n1. **Avicii** — “The Nights”\n2. **Kasabian** — “Stevie”\n\nSee the [source](https://example.com/ranking).\n\n<img src=x onerror=alert(1)>',
                assumptions: [],
                tables: [],
                caveats: [],
                clarification: null,
                findings: [],
            },
        });
    });
    await trust(page);
    await useAdvancedMode(page);
    await page.getByTestId('open-ai').click();
    await page
        .getByRole('textbox', { name: 'Ask AI', exact: true })
        .fill('Give me a short ranked list');
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    const answer = page.getByTestId('assistant-answer-markdown');
    await expect(answer.locator('ol > li')).toHaveCount(2);
    await expect(answer.locator('ol > li').first().locator('strong')).toHaveText('Avicii');
    const source = answer.getByRole('link', { name: 'source', exact: true });
    await expect(source).toHaveAttribute('href', 'https://example.com/ranking');
    await expect(source).toHaveAttribute('target', '_blank');
    await expect(source).toHaveAttribute('rel', 'noreferrer');
    await expect(answer.locator('img')).toHaveCount(0);
});

test('Ask AI formats proposal citations in summaries and assumptions', async ({ page }) => {
    await page.route('**/api/assistant/sql', async route => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
            json: {
                id: 'markdown-proposal',
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-23T00:00:00.000Z',
                baseSql: String(body.sql ?? ''),
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: [],
                decision: 'pending',
                sql: 'SELECT 1',
                summary:
                    'Since 1990 means seasons through 2025-26. ([laseriea.org]\\([https://www.laseriea.org/statistiche/albo-doro/](https://www.laseriea.org/statistiche/albo-doro/)))',
                assumptions: [
                    'The 2004-05 season is omitted because it had no official winner. ([channelnewsasia.com]\\([https://www.channelnewsasia.com/sport/list-seriea-champions-6097411](https://www.channelnewsasia.com/sport/list-seriea-champions-6097411)))\n\n<img src=x onerror=alert(1)>',
                ],
                tables: [],
                caveats: [],
                clarification: null,
                findings: [],
                sources: [
                    {
                        title: 'Serie A official history',
                        url: 'https://www.laseriea.org/statistiche/albo-doro/',
                    },
                    {
                        title: 'Channel News Asia',
                        url: 'https://www.channelnewsasia.com/sport/list-seriea-champions-6097411',
                    },
                ],
            },
        });
    });
    await trust(page);
    await useAdvancedMode(page);
    await page.getByTestId('open-ai').click();
    await page
        .getByRole('textbox', { name: 'Ask AI', exact: true })
        .fill('Show Serie A champions since 1990');
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    const summary = page.getByTestId('assistant-proposal-summary');
    const summaryCitation = summary.getByRole('link', { name: 'laseriea.org', exact: true });
    await expect(summaryCitation).toHaveAttribute(
        'href',
        'https://www.laseriea.org/statistiche/albo-doro/',
    );
    await expect(summaryCitation).toHaveAttribute('target', '_blank');
    await expect(summary).toContainText('(laseriea.org)');
    await expect(summary).not.toContainText('[laseriea.org]');

    await page.locator('.assistant-supporting-details > summary').click();
    const assumption = page
        .locator('.proposal-point')
        .filter({ hasText: 'The 2004-05 season is omitted' });
    await expect(assumption.locator(':scope > span')).toHaveText('ASSUMPTION');
    const assumptionCitation = assumption.getByRole('link', {
        name: 'channelnewsasia.com',
        exact: true,
    });
    await expect(assumptionCitation).toHaveAttribute(
        'href',
        'https://www.channelnewsasia.com/sport/list-seriea-champions-6097411',
    );
    await expect(assumption).toContainText('(channelnewsasia.com)');
    await expect(assumption).not.toContainText('[channelnewsasia.com]');
    await expect(assumption.locator('img')).toHaveCount(0);
    await expect(page.locator('.assistant-web-sources a')).toHaveCount(2);
    await expect(page.locator('.proposal-card').getByTestId('sql-proposal-diff')).toBeVisible();
});

test('Ask AI shows a stop action while a response is in progress', async ({ page }) => {
    let releaseResponse: (() => void) | undefined;
    let markRequestStarted: (() => void) | undefined;
    const responseGate = new Promise<void>(resolve => {
        releaseResponse = resolve;
    });
    const requestStarted = new Promise<void>(resolve => {
        markRequestStarted = resolve;
    });
    await page.route('**/api/assistant/sql', async route => {
        markRequestStarted?.();
        await responseGate;
        await route.fulfill({ json: {} }).catch(() => undefined);
    });

    try {
        await trust(page);
        await useAdvancedMode(page);
        await page.getByTestId('open-ai').click();
        const question = page.getByRole('textbox', { name: 'Ask AI', exact: true });
        await question.fill('Explain this query');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await requestStarted;

        const stop = page.getByRole('button', { name: 'Stop assistant response', exact: true });
        await expect(stop).toBeVisible();
        await stop.click();
        await expect(page.locator('.assistant-turn-error')).toHaveText('Request cancelled.');
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    } finally {
        releaseResponse?.();
    }
});

test('Ask AI keeps a custom conversation name after its first message', async ({ page }) => {
    await page.route('**/api/assistant/sql', async route => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
            json: {
                id: 'custom-title-answer',
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-23T00:00:00.000Z',
                baseSql: String(body.sql ?? ''),
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: [],
                decision: 'pending',
                sql: null,
                summary: 'Custom title kept',
                assumptions: [],
                tables: [],
                caveats: [],
                clarification: null,
                findings: [],
            },
        });
    });
    await trust(page);
    await useAdvancedMode(page);
    await page.getByTestId('open-ai').click();
    await page.getByRole('button', { name: 'Chat history: New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Actions for New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page
        .getByRole('textbox', { name: 'New name for New chat', exact: true })
        .fill('Flight lookup');
    await page.getByRole('button', { name: 'Save conversation name', exact: true }).click();
    await page.getByRole('textbox', { name: 'Ask AI', exact: true }).fill('Find a flight');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('Custom title kept', { exact: true })).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Chat history: Flight lookup', exact: true }),
    ).toBeVisible();
});

test('Scripts show each statement outcome and open that statement’s retained result', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1; SELECT fixture_error; SELECT 3;');
    await runScript(page);

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(results.getByLabel('Script statement results')).toContainText('partial');
    const first = results.getByRole('button', { name: 'Statement 1: succeeded', exact: true });
    const second = results.getByRole('button', { name: 'Statement 2: failed', exact: true });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    await expect(
        results.getByRole('button', { name: 'Statement 3: skipped', exact: true }),
    ).toBeVisible();

    await first.click();
    await expect(results.locator('.results-title [data-run-status]')).toHaveCount(0);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await expect(results.locator('.result-provenance-header')).toHaveCount(0);

    await second.click();
    await expect(page.getByTestId('query-failure')).toContainText('FIXTURE_ERROR');
    await expect(page.locator('.cm-content')).toContainText(
        'SELECT 1; SELECT fixture_error; SELECT 3;',
    );
    await first.click();

    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
});

test('Script errors without a statement run ID show the ClickHouse error and failed SQL', async ({
    page,
}) => {
    await trust(page);
    const sql = 'SELECT 1 AS value FORMAT JSONEachRow; SELECT 2';
    await replaceSql(page, sql);
    const message =
        'Syntax error: failed at position 39 (FORMAT) (line 2, col 1): FORMAT JSONCompactStringsEachRowWithNamesAndTypes. Expected one of: SETTINGS, ParallelWithClause, PARALLEL WITH, end of query. This full server diagnostic is retained below with every parser hint and query context so you can identify the invalid clause and correct the SQL.';
    const cleanup = await mockFailedScriptWithoutRunId(
        page,
        'script-create-table-error',
        sql,
        message,
    );

    try {
        await runScript(page);
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        const failure = page.getByTestId('query-failure');
        await expect(failure).toContainText('CLICKHOUSE_ERROR');
        await expect(failure).toContainText(message);
        await expect(
            results.getByRole('button', { name: 'Statement 1: failed', exact: true }),
        ).toBeVisible();
        await expect(
            results.getByRole('button', { name: 'Statement 2: skipped', exact: true }),
        ).toBeVisible();
        await expect(failure.locator('.result-failure-detail')).toBeHidden();
        await expect(failure.locator('.result-failure-marker')).toHaveCount(0);
        await failure.locator('summary').click();
        await expect(failure.locator('.result-failure-detail')).toHaveText(
            `[CLICKHOUSE_ERROR] ${message}`,
        );
        await expect(failure.locator('.result-execution-sql.is-full')).toHaveText(
            'SELECT 1 AS value FORMAT JSONEachRow',
        );
    } finally {
        await cleanup();
    }
});

test('A script error without a run ID replaces the previous visible result', async ({ page }) => {
    await trust(page);
    const results = await runQuery(page);
    const sql = 'SELECT * FROM default.missing_table; SELECT 2';
    await replaceSql(page, sql);
    const cleanup = await mockFailedScriptWithoutRunId(
        page,
        'script-create-table-error-with-previous-run',
        sql,
    );

    try {
        await runScript(page);
        await expect(page.getByTestId('query-failure')).toContainText('CLICKHOUSE_ERROR');
        await expect(results.locator('.result-row-count')).toHaveCount(0);
        await expect(results.locator('.result-provenance-header')).toHaveCount(0);
        await expect(results.getByRole('table')).toHaveCount(0);
    } finally {
        await cleanup();
    }
});

test('A script submission failure still lets a successful statement open its result', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1');
    const response = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    const results = await runQuery(page);
    const run = runIdentity(await (await response).json());
    const sql = 'SELECT 1; SELECT missing_table';
    const script = {
        id: 'script-no-second-run',
        owner: 'local-owner',
        connectionId: 'demo',
        sql,
        createdAt: '2026-09-23T00:00:00.000Z',
        status: 'partial',
        stopOnError: true,
        cancelled: false,
        statements: [
            { sql: 'SELECT 1', from: 0, to: 8, runId: run.id, status: 'succeeded' },
            {
                sql: 'SELECT missing_table',
                from: 10,
                to: sql.length,
                status: 'failed',
                error: { code: 'CLICKHOUSE_ERROR', message: 'Table missing_table does not exist.' },
            },
        ],
    };
    await page.route(
        url => url.pathname === '/api/scripts' || url.pathname === `/api/scripts/${script.id}`,
        async route => {
            await route.fulfill({
                status: route.request().method() === 'POST' ? 202 : 200,
                json: script,
            });
        },
    );
    await replaceSql(page, sql);
    await runScript(page);
    await expect(results.getByTestId('query-failure')).toBeVisible();
    await expect(results.getByRole('table')).toHaveCount(0);
    await results.getByRole('button', { name: 'Statement 1: succeeded', exact: true }).click();
    await expect(results.getByTestId('query-failure')).toHaveCount(0);
    await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
    await expect(page.locator('.query-failed-status')).toHaveCount(0);
    await results.getByRole('button', { name: 'Statement 2: failed', exact: true }).click();
    await expect(results.getByTestId('query-failure')).toContainText(
        'Table missing_table does not exist.',
    );
    await expect(results.getByRole('table')).toHaveCount(0);
    await expect(
        results.getByRole('button', { name: 'Statement 2: failed', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
});

test('Script polling persists every statement run ID, including fast intermediate results', async ({
    page,
}) => {
    await trust(page);
    const sql = 'SELECT 1; SELECT 2; SELECT 3;';
    await replaceSql(page, sql);
    const created = {
        id: 'script-fast',
        owner: 'local-owner',
        connectionId: 'demo',
        sql,
        createdAt: '2026-09-23T00:00:00.000Z',
        status: 'running',
        stopOnError: true,
        cancelled: false,
        statements: [
            { sql: 'SELECT 1', from: 0, to: 8, runId: 'run-a', status: 'succeeded' },
            { sql: 'SELECT 2', from: 10, to: 18, status: 'pending' },
            { sql: 'SELECT 3', from: 20, to: 28, status: 'pending' },
        ],
    };
    const completed = {
        ...created,
        status: 'succeeded',
        statements: [
            { sql: 'SELECT 1', from: 0, to: 8, runId: 'run-a', status: 'succeeded' },
            { sql: 'SELECT 2', from: 10, to: 18, runId: 'run-b', status: 'succeeded' },
            { sql: 'SELECT 3', from: 20, to: 28, runId: 'run-c', status: 'succeeded' },
        ],
    };
    await page.route('**/api/scripts', route => route.fulfill({ status: 202, json: created }));
    await page.route('**/api/scripts/script-fast', route => route.fulfill({ json: completed }));
    await page.route('**/api/runs/run-c', route =>
        route.fulfill({
            json: {
                id: 'run-c',
                queryId: 'query-c',
                owner: 'local-owner',
                connectionId: 'demo',
                dataSource: 'fixture',
                sql: 'SELECT 3',
                kind: 'query',
                parameters: {},
                limits: { rows: 5000, bytes: 2000000, seconds: 30, memory: 536870912, threads: 4 },
                tags: {},
                status: 'succeeded',
                createdAt: created.createdAt,
                elapsedMs: 1,
                rowCount: 1,
                bytes: 8,
                columns: [],
                warnings: [],
                sequence: 1,
                resultState: 'expired',
                requestedBy: 'local-owner',
                executedAs: 'fixture-reader',
                permissionSnapshot: { readonly: true, role: 'owner' },
                retryPolicy: 'never',
            },
        }),
    );
    await runScript(page);

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(
        results.getByRole('button', { name: 'Statement 3: succeeded', exact: true }),
    ).toBeVisible();
    const runIds = async () =>
        page.evaluate(() => {
            const value = localStorage.getItem('clickstudio:workspace:demo:v1');
            if (!value) return [];
            const workspace = JSON.parse(value) as {
                tabs: { id: string; runIds: string[]; activeRunId?: string }[];
                activeId: string;
            };
            return workspace.tabs.find(tab => tab.id === workspace.activeId)?.runIds ?? [];
        });
    await expect.poll(runIds).toEqual(['run-a', 'run-b', 'run-c']);
    await expect
        .poll(async () =>
            page.evaluate(() => {
                const workspace = JSON.parse(
                    localStorage.getItem('clickstudio:workspace:demo:v1') ?? 'null',
                );
                return workspace?.tabs.find((tab: { id: string }) => tab.id === workspace.activeId)
                    ?.activeRunId;
            }),
        )
        .toBe('run-c');

    await page.reload();
    await expect.poll(runIds).toEqual(['run-a', 'run-b', 'run-c']);
    await expect
        .poll(async () =>
            page.evaluate(() => {
                const workspace = JSON.parse(
                    localStorage.getItem('clickstudio:workspace:demo:v1') ?? 'null',
                );
                return workspace?.tabs.find((tab: { id: string }) => tab.id === workspace.activeId)
                    ?.activeRunId;
            }),
        )
        .toBe('run-c');
});

test('Selecting an earlier script statement stops automatic following while later work runs', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, 'SELECT 1; SELECT fixture_slow;');
    await runScript(page);

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const first = results.getByRole('button', { name: 'Statement 1: succeeded', exact: true });
    const second = results.getByRole('button', { name: 'Statement 2: running', exact: true });
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    const nextPoll = page.waitForResponse(
        response =>
            response.request().method() === 'GET' &&
            new URL(response.url()).pathname.startsWith('/api/scripts/'),
    );
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await nextPoll;
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(second).toHaveAttribute('aria-pressed', 'false');
});

test('Cancelling a long-running query reaches a terminal cancelled state', async ({ page }) => {
    let releaseCancel: (() => void) | undefined;
    const cancelGate = new Promise<void>(resolve => {
        releaseCancel = resolve;
    });
    await page.route(
        url => /\/api\/runs\/[^/]+\/cancel$/.test(url.pathname),
        async route => {
            await cancelGate;
            await route.continue();
        },
    );
    try {
        await trust(page);
        await replaceSql(page, 'SELECT fixture_slow');
        await runButton(page).click();
        await expect(runButton(page)).toHaveAttribute('aria-label', 'Cancel');
        await expect(runButton(page)).toBeEnabled();
        const cancelRequest = page.waitForRequest(
            request =>
                request.method() === 'POST' &&
                /\/api\/runs\/[^/]+\/cancel$/.test(new URL(request.url()).pathname),
        );
        const cancelResponse = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                /\/api\/runs\/[^/]+\/cancel$/.test(new URL(response.url()).pathname),
        );
        await runButton(page).click();
        await cancelRequest;
        await expect(runButton(page)).toHaveAttribute('aria-label', 'Cancelling…');
        await expect(runButton(page)).toBeDisabled();
        releaseCancel?.();
        await cancelResponse;
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'cancelled',
            { timeout: 10000 },
        );
        await expect(runButton(page)).toHaveAttribute('aria-label', 'Run');
    } finally {
        releaseCancel?.();
    }
});

test('Cancellation stays available while execution profile loading is pending', async ({
    page,
}) => {
    let releaseProfile: () => void = () => {};
    const profileGate = new Promise<void>(resolve => {
        releaseProfile = () => resolve();
    });
    await page.route(
        url => /\/api\/runs\/[^/]+\/profile$/.test(url.pathname),
        async route => {
            await profileGate;
            await route.continue();
        },
    );
    try {
        await trust(page);
        await replaceSql(page, 'SELECT fixture_slow');
        const started = page.waitForResponse(
            response =>
                response.request().method() === 'POST' &&
                new URL(response.url()).pathname === '/api/runs',
        );
        await runButton(page).click();
        const run = runIdentity(await (await started).json());
        const cancel = runButton(page);
        await expect(cancel).toHaveAttribute('aria-label', 'Cancel');
        await expect(cancel).toBeVisible();
        const profileRequest = page.waitForRequest(
            request => new URL(request.url()).pathname === `/api/runs/${run.id}/profile`,
        );
        await page
            .locator('.results-tabs')
            .getByRole('tab', { name: 'Insights', exact: true })
            .click();
        await profileRequest;
        await expect(cancel).toBeEnabled();
        const cancelled = page.waitForResponse(
            response => new URL(response.url()).pathname === `/api/runs/${run.id}/cancel`,
        );
        await cancel.click();
        await cancelled;
        releaseProfile();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'cancelled',
            { timeout: 10000 },
        );
    } finally {
        releaseProfile();
    }
});

test('A query and its local draft recover after reload without rerunning', async ({ page }) => {
    let runRequests = 0;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            runRequests++;
    });
    await trust(page);
    await page
        .getByRole('textbox', { name: 'SQL document name', exact: true })
        .fill('ClickStudio demo.sql');
    await replaceSql(page, "SELECT 'draft survives reload'");
    const results = await runQuery(page);
    const queryId = await currentQueryId(page);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload();

    await expect(page.getByRole('textbox', { name: 'SQL document name', exact: true })).toHaveValue(
        'ClickStudio demo.sql',
    );
    await expect(page.locator('.cm-content')).toContainText("SELECT 'draft survives reload'");
    await expect(
        page
            .getByRole('region', { name: 'Query results', exact: true })
            .getByRole('table', { name: 'Retained query rows' }),
    ).toBeVisible();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    expect(runRequests).toBe(1);
    await expect(results).toHaveCount(1);
});

for (const outcome of ['failed', 'pending'] as const) {
    test(`Analyzer reloads earlier SQL after a ${outcome} request replaces its tree`, async ({
        page,
    }) => {
        const firstSql = 'SELECT count() FROM demo.events';
        const secondSql = 'SELECT sum(value) FROM demo.events';
        let firstRequests = 0;
        let secondRequested = false;
        let pendingFinished = false;
        let releasePending: (() => void) | undefined;
        await page.route('**/api/connections/demo/query-tree', async route => {
            const body = route.request().postDataJSON() as { sql: string };
            if (body.sql === secondSql) {
                secondRequested = true;
                if (outcome === 'failed') {
                    await route.fulfill({
                        status: 400,
                        json: { error: { code: 'QUERY_TREE', message: 'Forced analyzer failure' } },
                    });
                    return;
                }
                await new Promise<void>(resolve => {
                    releasePending = resolve;
                });
                await route
                    .fulfill({
                        json: ['QUERY id: 0', '  TABLE id: 1, table_name: stale.events'],
                    })
                    .catch(() => {});
                pendingFinished = true;
                return;
            }
            if (body.sql === firstSql) firstRequests++;
            await route.fulfill({
                json: ['QUERY id: 0', '  TABLE id: 1, table_name: demo.events'],
            });
        });
        try {
            await trust(page);
            await replaceSql(page, firstSql);
            await runButton(page).click();
            await page.getByRole('tab', { name: 'SQL map', exact: true }).click();
            const structure = page.locator('.sql-flow-view');
            await structure.getByRole('button', { name: 'Analyzer', exact: true }).click();
            const table = structure.locator('[data-query-tree-type="TABLE"]');
            await expect(table).toContainText('demo.events');
            await replaceSql(page, secondSql);
            await expect.poll(() => secondRequested).toBe(true);
            if (outcome === 'failed')
                await expect(structure.getByRole('alert')).toContainText('Forced analyzer failure');
            else
                await expect(structure.locator('.analyzer-tree-view')).toContainText(
                    'Loading ClickHouse analyzer',
                );
            await replaceSql(page, firstSql);
            await expect(table).toContainText('demo.events');
            expect(firstRequests).toBeGreaterThanOrEqual(2);
            releasePending?.();
            if (outcome === 'pending') await expect.poll(() => pendingFinished).toBe(true);
            await expect(table).toContainText('demo.events');
        } finally {
            releasePending?.();
        }
    });
}
