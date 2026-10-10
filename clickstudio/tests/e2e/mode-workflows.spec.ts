import { test, expect, type Page } from '@playwright/test';
import {
    currentQueryId,
    jsonRecord,
    openBlankSql,
    openWorkspacePanel,
    replaceSql,
    runIdentity,
    runScript,
    trust,
    trustCurrentConnection,
    useAdvancedMode,
} from './helpers.js';

const generatedSql = 'SELECT day, events FROM demo.events ORDER BY day';

async function beginInCompactMode(page: Page) {
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'beginner'));
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'SQL editor', exact: true })).toBeVisible();
    await expect(page.getByTestId('open-ai')).toBeVisible();
    await expect(page.getByTestId('format-sql')).toBeVisible();
    await expect(page.getByTestId('run-button')).toHaveCount(1);
    await expect(page.getByTestId('save-query')).toHaveCount(1);
    await expect(page.locator('.draft-status')).toHaveCount(0);
    await expect(page.locator('.restore-sql-trigger')).toHaveCount(0);
    await expect(page.locator('.revision-history-trigger')).toHaveCount(0);
    await expect(page.locator('.editor-control-rail')).toHaveCount(0);
    await expect(page.locator('.editor-heading-tools')).toHaveCount(0);
    await expect(page.locator('.parser-switch')).toHaveCount(0);
    await expect(page.getByTestId('new-sql')).toBeVisible();
    await expect(page.locator('.document-tabs.is-compact-single')).toBeVisible();
    const tab = page.getByRole('tablist', { name: 'SQL documents', exact: true }).getByRole('tab');
    const documentName = await page
        .getByRole('textbox', { name: 'SQL document name', exact: true })
        .inputValue();
    await expect(tab).toHaveCount(1);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(tab).toHaveAttribute('aria-label', documentName);
    await expect(tab.getByRole('button', { name: /^Close / })).toHaveCount(1);
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', /^document-tab-/);
    await expect(
        page.getByRole('textbox', { name: 'Describe your data question', exact: true }),
    ).toHaveCount(0);
    await trustCurrentConnection(page);
    await expect(page.getByTestId('run-button')).toBeEnabled();
}

test('Standard exposes assignment actions and can run a query without opening AI', async ({
    page,
}) => {
    let contextRequests = 0;
    page.on('request', request => {
        if (
            request.method() === 'POST' &&
            new URL(request.url()).pathname === '/api/assistant/context'
        )
            contextRequests++;
    });
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'beginner'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const editor = page.getByRole('textbox', { name: 'SQL editor', exact: true });
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('SELECT');
    await expect(page.getByTestId('open-ai')).toBeVisible();
    await expect(page.getByTestId('format-sql')).toBeVisible();
    await expect(page.getByTestId('run-button')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
    const exportButton = page.getByRole('button', { name: 'Export', exact: true });
    await expect(exportButton).toBeEnabled();
    await exportButton.click();
    const exportDialog = page.getByRole('dialog', { name: 'Export' });
    await expect(exportDialog.getByRole('button', { name: /Export query/ })).toBeEnabled();
    await expect(exportDialog.getByRole('button', { name: /Export rows/ })).toBeDisabled();
    await exportDialog.getByRole('button', { name: 'Close export options' }).click();
    await expect(page.locator('.editor-control-rail')).toHaveCount(0);
    await expect(
        page.getByRole('textbox', { name: 'Describe your data question', exact: true }),
    ).toHaveCount(0);

    const runQuery = page.getByTestId('run-button');
    if (await runQuery.isDisabled()) {
        await page.getByRole('button', { name: 'Start exploring', exact: true }).click();
        await expect(runQuery).toBeEnabled();
    }
    await runQuery.click();
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(
        results.getByRole('table', { name: 'Retained query rows', exact: true }),
    ).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Results', exact: true })).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Chart', exact: true })).toBeVisible();
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-workspace, .chart-table-fallback')).toBeVisible();
    await results.getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(exportButton).toBeEnabled();
    await exportButton.click();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page
            .getByRole('dialog', { name: 'Export' })
            .getByRole('button', { name: /Export rows/ })
            .click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    await expect(
        page.getByRole('banner').getByRole('button', { name: /SAMPLE DATA/ }),
    ).toBeVisible();
    expect(contextRequests).toBe(0);
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toHaveCount(0);

    const queryId = await currentQueryId(page);
    await useAdvancedMode(page);
    await expect(page.locator('.cm-content')).toContainText('SELECT');
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    await expect(page.getByTestId('open-ai')).toBeVisible();
    await expect(page.getByTestId('save-query')).toBeVisible();
    await expect(page.locator('.editor-control-rail')).toBeVisible();
    await expect(page.locator('.parser-switch')).toHaveCount(0);
    await expect(results.getByRole('tab', { name: 'Chart', exact: true })).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toBeVisible();
    await expect(
        page.getByRole('tablist', { name: 'SQL documents', exact: true }).getByRole('tab'),
    ).toHaveCount(1);
    await page.getByText('Standard', { exact: true }).click();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    await expect(
        results.getByRole('table', { name: 'Retained query rows', exact: true }),
    ).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Chart', exact: true })).toBeVisible();
    await expect(page.getByTestId('open-ai')).toBeVisible();
    await expect(page.locator('.parser-switch')).toHaveCount(0);
});

test('Experimental keeps one format action and opens AI from the workspace rail', async ({
    page,
}) => {
    await beginInCompactMode(page);
    await useAdvancedMode(page);

    const queryHeader = page.locator('.editor-heading');
    await expect(queryHeader.getByTestId('open-ai')).toHaveCount(0);
    await expect(queryHeader.getByTestId('format-sql')).toHaveCount(1);
    await expect(queryHeader.locator('.formatter-control, .formatter-choice')).toHaveCount(0);
    await expect(queryHeader.getByRole('button', { name: 'WASM', exact: true })).toHaveCount(0);
    await expect(queryHeader.getByRole('button', { name: 'Built-in', exact: true })).toHaveCount(0);

    const assistantRailButton = page.locator('.icon-rail').getByTestId('open-ai');
    await expect(assistantRailButton).toBeVisible();
    await assistantRailButton.click();
    await expect(page.locator('.assistant-panel')).toBeVisible();
});

for (const experience of ['beginner', 'expert']) {
    for (const preference of [null, 'basic']) {
        test(`${experience} uses WASM with ${preference ?? 'no'} saved parser preference`, async ({
            page,
        }) => {
            await page.addInitScript(
                ({ experience, preference }) => {
                    localStorage.setItem('clickstudio:experience', experience);
                    if (preference === null) localStorage.removeItem('clickstudio:parser-mode');
                    else localStorage.setItem('clickstudio:parser-mode', preference);
                },
                { experience, preference },
            );
            await page.goto('/');
            await expect(page.locator('.parser-switch')).toHaveCount(0);
            const banner = page.getByRole('banner');
            await expect(banner.getByRole('radio', { name: 'WASM', exact: true })).toHaveCount(0);
            await expect(
                banner.getByRole('radio', { name: 'CodeMirror', exact: true }),
            ).toHaveCount(0);
            await replaceSql(page, 'select uniqExact(number) as value from numbers(3)');
            await expect(page.locator('.cm-native-function').first()).toHaveText('uniqExact');
            await page.getByTestId('format-sql').click();
            await expect(page.locator('.cm-content .cm-line')).toHaveText([
                'SELECT uniqExact(number) AS value',
                'FROM numbers(3)',
            ]);
            await page.reload();
            await expect(page.locator('.cm-native-function').first()).toHaveText('uniqExact');
        });
    }
}

test('Experimental Format stays available while WASM loads', async ({ page }) => {
    let parserRequested = false;
    let releaseParser!: () => void;
    const pendingParser = new Promise<void>(resolve => {
        releaseParser = resolve;
    });
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'expert'));
    await page.context().route('**/clickhouse-parser.wasm', async route => {
        parserRequested = true;
        await pendingParser;
        await route.continue();
    });
    try {
        await page.goto('/');
        await expect.poll(() => parserRequested).toBe(true);
        await replaceSql(page, 'select 1 as value from numbers(1)');
        await page.getByTestId('format-sql').click();
        await expect(page.locator('.cm-content .cm-line')).toHaveText([
            'select 1 as value',
            'FROM numbers(1)',
        ]);
        releaseParser();
        await openWorkspacePanel(page, 'parser');
        await expect(page.getByText('Ready · local WebAssembly', { exact: true })).toBeVisible();
    } finally {
        releaseParser();
    }
});

test('Experimental Format uses the built-in formatter when WASM is unavailable', async ({
    page,
}) => {
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'expert'));
    await page
        .context()
        .route('**/clickhouse-parser.wasm', route =>
            route.fulfill({ status: 503, body: 'Parser unavailable' }),
        );
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Retry parser', exact: true })).toBeVisible();
    await replaceSql(page, 'select 1 as value from numbers(1)');
    await page.getByTestId('format-sql').click();
    await expect(page.locator('.cm-content .cm-line')).toHaveText([
        'select 1 as value',
        'FROM numbers(1)',
    ]);
});

test('Standard keeps AI open after successful and failed query runs', async ({ page }) => {
    await beginInCompactMode(page);
    await page.getByTestId('open-ai').click();

    const assistant = page.locator('.assistant-panel');
    const question = page.getByRole('textbox', { name: 'Ask AI', exact: true });
    const runButton = page.getByTestId('run-button');
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(assistant).toBeVisible();
    await expect(runButton).toBeEnabled();
    await question.fill('Keep the AI panel open');

    await runButton.click();
    await expect(
        results.getByRole('table', { name: 'Retained query rows', exact: true }),
    ).toBeVisible();
    await expect(assistant).toBeVisible();
    await expect(question).toHaveValue('Keep the AI panel open');

    const runRoute = (url: URL) => url.pathname === '/api/runs';
    await page.route(runRoute, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fulfill({
            status: 400,
            json: {
                error: {
                    code: 'SYNTAX_ERROR',
                    message: 'Syntax error at position 15',
                    position: 15,
                },
            },
        });
    });

    try {
        await replaceSql(page, 'SELECT * FROM missing_table');
        await runButton.click();
        await expect(page.getByTestId('query-failure')).toContainText('SYNTAX_ERROR');
        await expect(assistant).toBeVisible();
        await expect(question).toHaveValue('Keep the AI panel open');
    } finally {
        await page.unroute(runRoute);
    }
});

test('Standard shows a single document tab and keeps tabs for multiple queries', async ({
    page,
}) => {
    await beginInCompactMode(page);
    await expect(page.locator('.document-tabs.is-compact-single')).toBeVisible();
    await openBlankSql(page);
    const tabs = page.getByRole('tablist', { name: 'SQL documents', exact: true }).getByRole('tab');
    await expect(page.locator('.document-tabs.is-compact-single')).toHaveCount(0);
    await expect(tabs).toHaveCount(2);
    await expect(page.getByTestId('new-sql')).toBeVisible();
    await expect(page.getByTestId('save-query')).toHaveCount(1);
    await tabs
        .last()
        .getByRole('button', { name: /^Close / })
        .click();
    await expect(page.locator('.document-tabs.is-compact-single')).toBeVisible();
    await expect(tabs).toHaveCount(1);
    await expect(tabs).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('button', { name: /^Close / })).toHaveCount(1);
    await expect(page.locator('.restore-sql-trigger')).toHaveCount(1);
});

test('Switching to Experimental keeps the AI chat, query and run evidence', async ({ page }) => {
    const generations: Record<string, unknown>[] = [];
    const runRequests: Record<string, unknown>[] = [];
    let proposalBaseSql = '';
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            runRequests.push(jsonRecord(request.postDataJSON(), 'Run request'));
    });
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'SQL generation request');
        generations.push(body);
        proposalBaseSql = String(body.sql ?? '');
        await route.fulfill({
            json: {
                id: 'test-proposal',
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-23T00:00:00.000Z',
                baseSql: proposalBaseSql,
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: ['Fixture-backed mock'],
                decision: 'pending',
                sql: generatedSql,
                summary:
                    'Show the sample event counts by day. ([nba.com](https://www.nba.com/news/history-nba-champions?lid=odtil4le7cgc))',
                assumptions: [],
                tables: ['demo.events'],
                caveats: ['The demo fixture does not evaluate SQL.'],
                clarification: null,
                findings: [],
                sources: [
                    {
                        title: 'NBA champions',
                        url: 'https://www.nba.com/news/history-nba-champions?lid=odtil4le7cgc',
                    },
                ],
                quality: {
                    evaluatorVersion: 'test',
                    evaluatedAt: '2026-09-23T00:00:00.000Z',
                    status: 'pass',
                    score: 100,
                    checks: [],
                },
            },
        });
    });
    await page.route('**/api/assistant/proposals/test-proposal/decision', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Assistant decision request');
        const decision = body.decision;
        if (decision !== 'accepted' && decision !== 'rejected')
            throw new Error('Assistant decision request did not include a valid decision');
        await route.fulfill({
            json: {
                id: 'test-proposal',
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-23T00:00:00.000Z',
                decidedAt: '2026-09-23T00:00:01.000Z',
                baseSql: proposalBaseSql,
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: ['Fixture-backed mock'],
                decision,
                sql: generatedSql,
                summary:
                    'Show the sample event counts by day. ([nba.com](https://www.nba.com/news/history-nba-champions?lid=odtil4le7cgc))',
                assumptions: [],
                tables: ['demo.events'],
                caveats: [],
                clarification: null,
                findings: [],
                sources: [
                    {
                        title: 'NBA champions',
                        url: 'https://www.nba.com/news/history-nba-champions?lid=odtil4le7cgc',
                    },
                ],
            },
        });
    });

    await beginInCompactMode(page);
    await useAdvancedMode(page);
    await page.getByTestId('save-query').click();
    await expect(page.getByRole('status').filter({ hasText: 'revision 1' })).toBeVisible();
    await page.getByTestId('open-ai').click();
    const prompt = page.getByRole('textbox', { name: 'Ask AI', exact: true });
    await prompt.fill('Show event counts by day');
    await page
        .locator('.assistant-panel')
        .getByRole('button', { name: 'Send', exact: true })
        .click();
    const summary = page.getByTestId('assistant-proposal-summary');
    await expect(summary).toContainText('Show the sample event counts by day.');
    const citation = summary.getByRole('link', { name: 'nba.com', exact: true });
    await expect(citation).toHaveAttribute(
        'href',
        'https://www.nba.com/news/history-nba-champions?lid=odtil4le7cgc',
    );
    await expect(citation).toHaveAttribute('target', '_blank');
    await expect(citation).toHaveAttribute('rel', 'noreferrer');
    await expect(summary).not.toContainText('[nba.com]');
    await page.locator('.assistant-supporting-details > summary').click();
    const webSource = page
        .locator('.assistant-web-sources')
        .getByRole('link', { name: 'NBA champions', exact: true });
    await expect(webSource).toHaveAttribute(
        'href',
        'https://www.nba.com/news/history-nba-champions?lid=odtil4le7cgc',
    );
    await expect(page.locator('.assistant-answer-markdown')).toHaveCount(0);
    await expect(page.locator('.proposal-card').getByTestId('sql-proposal-diff')).toBeVisible();
    expect(generations).toHaveLength(1);
    expect(generations[0]).toMatchObject({
        action: 'ask',
        question: 'Show event counts by day',
        connectionId: 'demo',
    });
    expect(generations[0]?.schema).toBeTruthy();
    expect(runRequests).toHaveLength(0);
    await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText(generatedSql);
    expect(runRequests).toHaveLength(0);
    await page.getByTestId('run-button').click();

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    await expect(results.getByRole('cell', { name: '2026-01-01', exact: true })).toBeVisible();
    const queryId = await currentQueryId(page);
    await results.getByRole('tab', { name: 'Chart', exact: true }).click();
    await expect(results.locator('.chart-canvas svg[role="img"]')).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toBeVisible();
    await results.getByRole('tab', { name: 'Insights', exact: true }).click();
    const loadDetails = results.getByRole('button', {
        name: 'Load execution details',
        exact: true,
    });
    if (await loadDetails.count()) await loadDetails.click();
    await expect(results.getByText('Execution time', { exact: true })).toBeVisible();

    await expect(page.locator('.cm-content')).toContainText(generatedSql);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    await page.getByText('Standard', { exact: true }).click();
    await expect(page.getByTestId('open-ai')).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Chart', exact: true })).toBeVisible();
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toHaveCount(0);
    await expect(
        results.getByRole('table', { name: 'Retained query rows', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
    await useAdvancedMode(page);
    await expect(page.locator('.assistant-user-message')).toContainText('Show event counts by day');
    await expect(prompt).toHaveValue('');
    await expect(results.getByRole('tab', { name: 'Insights', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
    );
});

test('An older accepted proposal says which SQL will run', async ({ page }) => {
    const runRequests: Record<string, unknown>[] = [];
    let proposalBaseSql = '';
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            runRequests.push(jsonRecord(request.postDataJSON(), 'Run request'));
    });
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Assistant request');
        proposalBaseSql = String(body.sql ?? '');
        await route.fulfill({
            json: {
                id: 'stale-proposal',
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-23T00:00:00.000Z',
                baseSql: proposalBaseSql,
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: [],
                decision: 'pending',
                sql: generatedSql,
                summary: 'Show event counts by day.',
                assumptions: [],
                tables: ['demo.events'],
                caveats: [],
                clarification: null,
                findings: [],
            },
        });
    });
    await page.route('**/api/assistant/proposals/stale-proposal/decision', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Assistant decision');
        await route.fulfill({
            json: {
                id: 'stale-proposal',
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-23T00:00:00.000Z',
                decidedAt: '2026-09-23T00:00:01.000Z',
                baseSql: proposalBaseSql,
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: [],
                decision: body.decision,
                sql: generatedSql,
                summary: 'Show event counts by day.',
                assumptions: [],
                tables: ['demo.events'],
                caveats: [],
                clarification: null,
                findings: [],
            },
        });
    });

    await beginInCompactMode(page);
    const runButton = page.getByTestId('run-button');
    await expect(runButton).toBeEnabled();
    await page.getByTestId('open-ai').click();
    await page
        .getByRole('textbox', { name: 'Ask AI', exact: true })
        .fill('Show event counts by day');
    await page
        .locator('.assistant-panel')
        .getByRole('button', { name: 'Send', exact: true })
        .click();
    await expect(page.getByTestId('assistant-proposal-summary')).toContainText(
        'Show event counts by day.',
    );
    await page.getByRole('button', { name: 'Use this query', exact: true }).click();
    await replaceSql(page, 'SELECT 999 AS newer_draft');

    const oldProposal = page.locator('.beginner-run-ready');
    await expect(oldProposal).toContainText('Accepted from an earlier draft');
    const runOldSql = oldProposal.getByRole('button', { name: 'Run older query', exact: true });
    await expect(runOldSql).toBeVisible();
    await expect(runOldSql).toHaveClass(/button-secondary/);
    await runOldSql.click();

    await expect.poll(() => runRequests.length).toBe(1);
    expect(runRequests[0]).toMatchObject({ sql: generatedSql, connectionId: 'demo' });
});

test('Ask AI previews mixed writes and keeps UPDATE and DELETE alternatives separate', async ({
    page,
}) => {
    const combinedSql =
        "SELECT id FROM demo.events WHERE id = 1; ALTER TABLE demo.events UPDATE status = 'reviewed' WHERE id = 1; ALTER TABLE demo.events DELETE WHERE id = 1";
    const updateSql =
        "SELECT id FROM demo.events WHERE id = 1; ALTER TABLE demo.events UPDATE status = 'reviewed' WHERE id = 1";
    const deleteSql =
        'SELECT id FROM demo.events WHERE id = 1; ALTER TABLE demo.events DELETE WHERE id = 1';
    let proposalBaseSql = '';
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Assistant request');
        proposalBaseSql = String(body.sql ?? '');
        await route.fulfill({
            json: {
                id: 'script-options-proposal',
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-29T00:00:00.000Z',
                baseSql: proposalBaseSql,
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: [],
                decision: 'pending',
                sql: combinedSql,
                alternatives: [
                    {
                        title: 'Update matching row',
                        summary: 'Change the status and keep the event.',
                        sql: updateSql,
                    },
                    {
                        title: 'Delete matching row',
                        summary: 'Remove the matching event.',
                        sql: deleteSql,
                    },
                ],
                summary: 'Choose whether to update or delete the matching event.',
                assumptions: [],
                tables: ['demo.events'],
                caveats: [],
                clarification: null,
                findings: [],
            },
        });
    });
    await page.route('**/api/assistant/proposals/script-options-proposal/decision', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Assistant decision');
        await route.fulfill({
            json: {
                id: 'script-options-proposal',
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-29T00:00:00.000Z',
                decidedAt: '2026-09-29T00:00:01.000Z',
                baseSql: proposalBaseSql,
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: [],
                decision: body.decision,
                sql: combinedSql,
                alternatives: [
                    {
                        title: 'Update matching row',
                        summary: 'Change the status and keep the event.',
                        sql: updateSql,
                    },
                    {
                        title: 'Delete matching row',
                        summary: 'Remove the matching event.',
                        sql: deleteSql,
                    },
                ],
                summary: 'Choose whether to update or delete the matching event.',
                assumptions: [],
                tables: ['demo.events'],
                caveats: [],
                clarification: null,
                findings: [],
            },
        });
    });

    await beginInCompactMode(page);
    await page.getByTestId('open-ai').click();
    await page
        .getByRole('textbox', { name: 'Ask AI', exact: true })
        .fill('Give me separate update and delete options for this row');
    await page
        .locator('.assistant-panel')
        .getByRole('button', { name: 'Send', exact: true })
        .click();
    await expect(page.getByTestId('assistant-execution-option')).toHaveCount(3);
    const recommended = page.getByTestId('assistant-execution-option').nth(0);
    const alternative = page.getByTestId('assistant-execution-option').nth(1);
    const deleteAlternative = page.getByTestId('assistant-execution-option').nth(2);
    await expect(
        recommended.getByRole('list', { name: 'Statements in execution order' }).locator('li'),
    ).toHaveCount(3);
    await expect(recommended.locator('li').nth(0)).toHaveAttribute('data-operation', 'read');
    await expect(recommended.locator('li').nth(1)).toHaveAttribute('data-operation', 'update');
    await expect(recommended.locator('li').nth(2)).toHaveAttribute('data-operation', 'delete');
    await expect(recommended.locator('li').nth(0).locator('pre')).toBeHidden();
    await expect(recommended.locator('li').nth(1).locator('pre')).toBeHidden();
    await expect(recommended.locator('li').nth(2).locator('pre')).toBeHidden();
    await expect(alternative).toContainText('Update matching row');
    await expect(deleteAlternative).toContainText('Delete matching row');
    await expect(alternative.locator('li').nth(1)).toHaveAttribute('data-operation', 'update');
    await expect(deleteAlternative.locator('li').nth(1)).toHaveAttribute(
        'data-operation',
        'delete',
    );

    await page.getByRole('button', { name: 'Use this query', exact: true }).click();
    await expect(
        recommended.getByText('UPDATE runs before DELETE, which may remove the changed rows.', {
            exact: false,
        }),
    ).toBeVisible();
    await expect(
        recommended.getByText(/ClickHouse mutations may finish asynchronously\./),
    ).toBeVisible();
    await expect(
        recommended.getByRole('button', { name: 'Run all 3 statements', exact: true }),
    ).toBeVisible();
    await expect(
        recommended.getByRole('button', { name: /Review run|Confirm and run all/ }),
    ).toHaveCount(0);
    await expect(
        alternative.getByRole('button', {
            name: 'Run alternative: Update matching row',
            exact: true,
        }),
    ).toBeVisible();
    await expect(
        deleteAlternative.getByRole('button', {
            name: 'Run alternative: Delete matching row',
            exact: true,
        }),
    ).toBeVisible();
    await expect(
        recommended.getByRole('button', { name: 'Run only statement 2: Update', exact: true }),
    ).toBeVisible();
    await expect(
        recommended.getByRole('button', { name: 'Run only statement 3: Delete', exact: true }),
    ).toBeVisible();
    const readStep = recommended.locator('li').nth(0);
    await expect(
        readStep.getByRole('button', { name: 'Run only statement 1: Read', exact: true }),
    ).toBeVisible();
    await expect(
        readStep.getByRole('button', { name: 'Run only statement 1: Read', exact: true }),
    ).toBeEnabled();
    await readStep.locator('summary').click();
    await expect(readStep.locator('pre')).toBeVisible();

    await recommended.getByRole('button', { name: 'Run all 3 statements', exact: true }).click();
    await expect(page.getByTestId('query-failure')).toContainText('READ_ONLY_SQL');
});

test('Standard can run a script and open its statement results', async ({ page }) => {
    await beginInCompactMode(page);
    await replaceSql(page, 'SELECT 1; SELECT 2;');
    await expect(page.getByTestId('run-button')).toBeEnabled();
    await runScript(page);

    const results = page.getByRole('region', { name: 'Query results', exact: true });
    const first = results.getByRole('button', { name: 'Statement 1: succeeded', exact: true });
    const second = results.getByRole('button', { name: 'Statement 2: succeeded', exact: true });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    await first.click();
    await expect(
        results.getByRole('table', { name: 'Retained query rows', exact: true }),
    ).toBeVisible();
});

test('Standard import opens from the left rail and formatting is available in the editor', async ({
    page,
}) => {
    await beginInCompactMode(page);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const importDialog = page.getByRole('dialog', { name: 'Import data', exact: true });
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('button', { name: 'Close import wizard', exact: true }).click();

    await replaceSql(page, 'select 1 as value from numbers(1)');
    await page.getByTestId('format-sql').click();
    await expect(page.locator('.cm-content .cm-line')).toHaveText([
        'SELECT 1 AS value',
        'FROM numbers(1)',
    ]);
});

test('Experimental insights and AI requests do not execute SQL', async ({ page }) => {
    const runRequests: unknown[] = [];
    const assistantRequests: Record<string, unknown>[] = [];
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
            runRequests.push(request.postDataJSON());
    });
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON(), 'Assistant request');
        assistantRequests.push(body);
        await route.fulfill({
            json: {
                id: 'expert-proposal',
                owner: 'local-owner',
                connectionId: 'demo',
                action: 'ask',
                createdAt: '2026-09-23T00:00:00.000Z',
                baseSql: String(body.sql ?? ''),
                responseId: 'test-response',
                model: 'test-model',
                promptVersion: 'test',
                contextSummary: ['Fixture-backed mock'],
                decision: 'pending',
                sql: null,
                summary: 'The fixture has no measured performance data.',
                assumptions: [],
                tables: [],
                caveats: ['Demo runs do not measure ClickHouse performance.'],
                clarification: null,
                findings: [
                    {
                        severity: 'low',
                        message: 'No slowdown can be inferred from fixture data.',
                        evidence: 'The sample driver is not a ClickHouse server.',
                    },
                ],
            },
        });
    });

    await trust(page);
    await useAdvancedMode(page);
    const editor = page.getByRole('textbox', { name: 'SQL editor', exact: true });
    await expect(editor).toBeVisible();
    const startedRun = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/runs',
    );
    await page.getByTestId('run-button').click();
    const activeRunId = runIdentity(await (await startedRun).json()).id;
    const results = page.getByRole('region', { name: 'Query results', exact: true });
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-run-status', 'succeeded');
    const queryId = await currentQueryId(page);

    await results.getByRole('tab', { name: 'Insights', exact: true }).click();
    const loadDetails = results.getByRole('button', {
        name: 'Load execution details',
        exact: true,
    });
    if (await loadDetails.count()) await loadDetails.click();
    await expect(results.getByText('Execution time', { exact: true })).toBeVisible();

    await openWorkspacePanel(page, 'pipeline');
    await expect(page.locator('.pipeline-stage').first()).toBeVisible();
    await page
        .getByRole('button', { name: 'Open operator graph in Insights', exact: true })
        .click();
    await expect(
        results.getByRole('region', { name: 'Scrollable operator graph', exact: true }),
    ).toBeVisible();
    await page.getByTestId('open-ai').click();
    await expect(page.locator('.assistant-task-picker')).toHaveCount(0);
    const question = page.getByRole('textbox', { name: 'Ask AI', exact: true });
    await question.fill('Why is this query slow?');
    const assistantRequest = page.waitForRequest(request => {
        const path = new URL(request.url()).pathname;
        return request.method() === 'POST' && path === '/api/assistant/sql';
    });
    await question.press('Enter');
    await assistantRequest;
    await expect(
        page.getByText('The fixture has no measured performance data.', { exact: true }),
    ).toBeVisible();
    expect(assistantRequests).toHaveLength(1);
    expect(assistantRequests[0]).toMatchObject({
        action: 'ask',
        question: 'Why is this query slow?',
        runId: activeRunId,
        includeRun: true,
    });
    expect(assistantRequests[0]?.result).toBeTruthy();
    expect(runRequests).toHaveLength(1);
    await expect(page.locator('.execution-bar')).toHaveAttribute('data-query-id', queryId);
});

for (const theme of ['Dark', 'Light'])
    test(`Experimental matches Standard query actions and opens SQL map after execution in ${theme} mode`, async ({
        page,
    }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await trust(page);
        await useAdvancedMode(page);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        const run = page.getByTestId('run-button');
        const header = page.locator('.editor-heading-actions');
        await expect(run).toHaveCount(1);
        await expect(page.getByTestId('save-query')).toHaveCount(1);
        await expect(page.locator('.editor-heading-tools')).toHaveCount(0);
        await expect(header.getByTestId('run-button')).toBeVisible();
        await expect(header.getByRole('button').nth(0)).toHaveAttribute(
            'data-testid',
            'format-sql',
        );
        await expect(header.getByRole('button').nth(1)).toHaveAttribute(
            'data-testid',
            'save-query',
        );
        await expect(header.getByRole('button').nth(2)).toHaveAttribute(
            'data-testid',
            'run-button',
        );
        await expect(
            page.getByRole('button', { name: 'Visualize SQL structure', exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole('tab', { name: 'SQL map', exact: true })).toHaveCount(0);
        for (const width of [1440, 720, 390]) {
            await page.setViewportSize({ width, height: 900 });
            await expect(page.getByTestId('save-query').locator('svg')).toHaveCSS(
                'width',
                width <= 560 ? '15px' : '14px',
            );
            const readActionStyles = () =>
                header
                    .locator('[data-testid="save-query"], [data-testid="run-button"]')
                    .evaluateAll(elements =>
                        elements.map(element => {
                            const style = getComputedStyle(element);
                            const bounds = element.getBoundingClientRect();
                            return {
                                width: bounds.width,
                                height: bounds.height,
                                fontSize: style.fontSize,
                                padding: style.padding,
                                gap: style.gap,
                                borderRadius: style.borderRadius,
                                color: style.color,
                                background: style.background,
                                shadow: style.boxShadow,
                            };
                        }),
                    );
            const experimentalStyles = await readActionStyles();
            await page.getByText('Standard', { exact: true }).click();
            await expect(page.locator('.workspace-root')).toHaveClass(/is-beginner/);
            await expect.poll(readActionStyles).toEqual(experimentalStyles);
            await useAdvancedMode(page);
            await expect(run).toBeVisible();
            await expect(run).toHaveText('Run');
            await expect(page.getByTestId('save-query')).toBeVisible();
            await expect(page.getByTestId('save-query')).toHaveText('Save');
            const overflow = await page.evaluate(
                () => document.documentElement.scrollWidth - innerWidth,
            );
            expect(overflow).toBeLessThanOrEqual(1);
        }
        let executions = 0;
        page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs')
                executions++;
        });
        await run.click();
        const results = page.getByRole('region', { name: 'Query results', exact: true });
        await expect(results.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
        await expect(results.getByRole('tab', { name: 'Results', exact: true })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await results.getByRole('tab', { name: 'SQL map', exact: true }).click();
        await expect(page.locator('.sql-flow-view')).toBeVisible();
        expect(executions).toBe(1);
    });
