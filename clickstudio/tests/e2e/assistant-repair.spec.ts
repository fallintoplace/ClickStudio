import { test, expect, type Page } from '@playwright/test';
import type { Proposal } from '../../shared/types.js';
import { jsonRecord, replaceSql, trust } from './helpers.js';

async function installRepair(page: Page, repairedSql: string) {
    const requests: Record<string, unknown>[] = [];
    let proposal: Proposal;
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        requests.push(body);
        proposal = {
            id: 'repair-test',
            owner: 'local-owner',
            connectionId: 'demo',
            action: 'repair',
            createdAt: '2026-10-10T00:00:00.000Z',
            baseSql: String(body.sql),
            responseId: 'repair-response',
            model: 'fixture',
            promptVersion: 'test',
            contextSummary: [],
            decision: 'pending',
            sql: repairedSql,
            summary: 'Use the events column.',
            assumptions: [],
            tables: ['demo.events'],
            caveats: [],
            clarification: null,
            findings: [],
        };
        await route.fulfill({ json: proposal });
    });
    await page.route('**/api/assistant/proposals/repair-test/decision', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        await route.fulfill({
            json: {
                ...proposal,
                decision: body.decision,
                decidedAt: '2026-10-10T00:00:01.000Z',
            },
        });
    });
    return requests;
}

async function rejectQuery(page: Page) {
    await page.route('**/api/runs', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fulfill({
            status: 400,
            json: {
                error: {
                    code: 'UNKNOWN_IDENTIFIER',
                    message: 'Unknown column event_count',
                    position: 12,
                },
            },
        });
    });
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('query-failure')).toContainText('UNKNOWN_IDENTIFIER');
    await page.unroute('**/api/runs');
}

for (const mode of ['beginner', 'expert'])
    test(`Fix with AI repairs and reruns a failed query in ${mode} mode`, async ({ page }) => {
        await page.addInitScript(
            mode => localStorage.setItem('clickstudio:experience', mode),
            mode,
        );
        await trust(page);
        await page.getByTestId('run-button').click();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
        const failedSql = 'SELECT day, event_count FROM demo.events ORDER BY day';
        const repairedSql = failedSql.replace('event_count', 'events');
        const requests = await installRepair(page, repairedSql);
        await page.getByTestId('open-ai').click();
        const composer = page.getByRole('textbox', { name: 'Ask AI', exact: true });
        await composer.fill('Keep my unfinished question');
        await replaceSql(page, failedSql);
        await rejectQuery(page);
        await page.getByRole('button', { name: 'Fix with AI', exact: true }).click();
        await expect(page.getByTestId('assistant-proposal-summary')).toHaveText(
            'Use the events column.',
        );
        await expect(composer).toHaveValue('Keep my unfinished question');
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
            action: 'repair',
            sql: failedSql,
            includeRun: false,
            repair: {
                sql: failedSql,
                error: '[UNKNOWN_IDENTIFIER] Unknown column event_count\nLine 1, column 13',
            },
        });
        expect(requests[0]?.runId).toBeUndefined();
        expect(requests[0]?.result).toBeUndefined();
        await page
            .getByRole('button', {
                name: mode === 'beginner' ? 'Use this query' : 'Apply to draft',
                exact: true,
            })
            .click();
        await expect(page.locator('.cm-content')).toHaveText(repairedSql);
        await page.getByTestId('run-button').click();
        await expect(page.locator('.execution-bar')).toHaveAttribute(
            'data-run-status',
            'succeeded',
        );
        await page.reload();
        await page.getByTestId('open-ai').click();
        await expect(page.getByTestId('assistant-proposal-summary')).toHaveText(
            'Use the events column.',
        );
    });

test('Fix with AI keeps the full draft when a selected statement fails', async ({ page }) => {
    await trust(page);
    const failedSql = 'SELECT day, event_count FROM demo.events';
    const draft = `SELECT 1;\n${failedSql};\nSELECT 2;`;
    const repairedDraft = draft.replace('event_count', 'events');
    const requests = await installRepair(page, repairedDraft);
    await replaceSql(page, draft);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+End');
    await page.keyboard.press('Shift+ArrowLeft');
    await rejectQuery(page);
    await page.getByRole('button', { name: 'Fix with AI', exact: true }).click();
    await expect(page.getByTestId('assistant-proposal-summary')).toBeVisible();
    expect(requests[0]).toMatchObject({ sql: draft, repair: { sql: failedSql } });
    await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    await expect(page.locator('.cm-line')).toHaveText(repairedDraft.split('\n'));
});

test('Fix with AI uses the failed script statement instead of an earlier successful run', async ({
    page,
}) => {
    await trust(page);
    const failedSql = 'SELECT fixture_error FROM demo.events';
    const draft = `SELECT 1;\n${failedSql};\nSELECT 2;`;
    const requests = await installRepair(page, draft.replace('fixture_error', 'events'));
    await replaceSql(page, draft);
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('query-failure')).toContainText('FIXTURE_ERROR');
    await page.getByRole('button', { name: 'Fix with AI', exact: true }).click();
    await expect(page.getByTestId('assistant-proposal-summary')).toBeVisible();
    expect(requests[0]).toMatchObject({
        sql: draft,
        includeRun: false,
        repair: { sql: failedSql },
    });
    expect(requests[0]?.result).toBeUndefined();
});

test('Fix with AI keeps an actionable query error when the assistant request fails', async ({
    page,
}) => {
    await trust(page);
    await replaceSql(page, 'SELECT event_count FROM demo.events');
    await rejectQuery(page);
    await page.route('**/api/assistant/sql', async route => {
        await route.fulfill({
            status: 502,
            json: { error: { code: 'AI_FAILED', message: 'Could not generate a repair.' } },
        });
    });
    const fix = page.getByRole('button', { name: 'Fix with AI', exact: true });
    await fix.click();
    await expect(page.locator('.assistant-panel')).toContainText('Could not generate a repair.');
    await expect(fix).toBeEnabled();
    await expect(page.getByTestId('query-failure')).toContainText('UNKNOWN_IDENTIFIER');
});
