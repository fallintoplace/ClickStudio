import { test, expect, type Page } from '@playwright/test';
import type { Proposal } from '../../shared/types.js';
import { jsonRecord, replaceSql, trust } from './helpers.js';

const originalSql = 'SELECT 1 AS value';
const proposedSql = 'SELECT 2 AS value';
const liveEditor = (page: Page) => page.locator('.editor-frame .cm-content');
const review = (page: Page) => page.getByTestId('sql-proposal-review');

async function installProposal(
    page: Page,
    sql: string | null = proposedSql,
    extra: Partial<Proposal> = {},
) {
    const proposalId = extra.id ?? 'editor-review-test';
    let proposal: Proposal;
    const decisions: Record<string, unknown>[] = [];
    let failDecision = false;
    await page.route('**/api/assistant/sql', async route => {
        const body = jsonRecord(route.request().postDataJSON());
        proposal = {
            id: proposalId,
            owner: 'local-owner',
            connectionId: 'demo',
            action: 'ask',
            createdAt: '2026-10-11T00:00:00.000Z',
            baseSql: String(body.sql),
            responseId: 'editor-review-response',
            model: 'fixture',
            promptVersion: 'test',
            contextSummary: [],
            decision: 'pending',
            sql,
            summary: 'Updated query.',
            assumptions: [],
            tables: [],
            caveats: [],
            clarification: null,
            findings: [],
            ...extra,
        };
        await route.fulfill({ json: proposal });
    });
    await page.route(`**/api/assistant/proposals/${proposalId}/decision`, async route => {
        const body = jsonRecord(route.request().postDataJSON());
        decisions.push(body);
        if (failDecision) {
            await route.fulfill({
                status: 503,
                json: { error: { code: 'UNAVAILABLE', message: 'Please try again.' } },
            });
            return;
        }
        await route.fulfill({
            json: { ...proposal, decision: body.decision, decidedAt: '2026-10-11T00:00:01.000Z' },
        });
    });
    return {
        decisions,
        failDecision: (value: boolean) => {
            failDecision = value;
        },
    };
}

async function askForChanges(page: Page, summary = 'Updated query.') {
    await page.getByTestId('open-ai').click();
    await page.getByRole('textbox', { name: 'Ask AI', exact: true }).fill('Update this query');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
        page.locator('.assistant-panel').getByText(summary, { exact: true }),
    ).toBeVisible();
}

async function storedDraft(page: Page) {
    return page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('clickstudio:workspace:demo:v1') ?? '{}') as {
            activeId: string;
            tabs: { id: string; sql: string; checkpoints: { reason: string; sql: string }[] }[];
        };
        return state.tabs?.find(tab => tab.id === state.activeId);
    });
}

for (const mode of ['beginner', 'expert']) {
    test(`Inline SQL review accepts the whole proposal without running it in ${mode} mode`, async ({
        page,
    }) => {
        await page.addInitScript(
            mode => localStorage.setItem('clickstudio:experience', mode),
            mode,
        );
        const { decisions } = await installProposal(page);
        let runs = 0;
        let saves = 0;
        page.on('request', request => {
            if (request.method() !== 'POST') return;
            const path = new URL(request.url()).pathname;
            if (path === '/api/runs' || path === '/api/scripts') runs++;
            if (path === '/api/documents') saves++;
        });
        await trust(page);
        await replaceSql(page, originalSql);
        await expect.poll(async () => (await storedDraft(page))?.sql).toBe(originalSql);
        await askForChanges(page);
        await expect(review(page)).toBeVisible();
        await expect(liveEditor(page)).toBeHidden();
        await expect(liveEditor(page)).toHaveText(originalSql);
        const preview = review(page).getByRole('textbox', {
            name: 'Proposed SQL changes',
            exact: true,
        });
        await expect(preview).toHaveAttribute('aria-readonly', 'true');
        await expect(preview).toHaveAttribute('contenteditable', 'false');
        await expect(review(page).locator('.cm-changedLine')).toHaveText(proposedSql);
        await expect(review(page).locator('.cm-deletedChunk')).toHaveText(originalSql);
        await expect(page.getByTestId('run-button')).toBeDisabled();
        await expect(page.getByTestId('save-query')).toBeDisabled();
        await expect(page.getByTestId('format-sql')).toBeDisabled();
        await page.keyboard.press('ControlOrMeta+s');
        await page.keyboard.press('ControlOrMeta+Enter');
        expect((await storedDraft(page))?.sql).toBe(originalSql);
        await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
        await expect(review(page)).toHaveCount(0);
        await expect(liveEditor(page)).toBeVisible();
        await expect(liveEditor(page)).toHaveText(proposedSql);
        await expect(page.getByTestId('sql-proposal-diff')).toContainText('Applied');
        await expect.poll(async () => (await storedDraft(page))?.sql).toBe(proposedSql);
        expect((await storedDraft(page))?.checkpoints).toContainEqual(
            expect.objectContaining({
                reason: 'Before accepted AI proposal',
                sql: originalSql,
            }),
        );
        expect(decisions).toEqual([
            { decision: 'accepted', connectionId: 'demo', currentSql: originalSql },
        ]);
        expect(runs).toBe(0);
        expect(saves).toBe(0);
        await page.reload();
        await expect(review(page)).toHaveCount(0);
        await expect(liveEditor(page)).toHaveText(proposedSql);
    });
}

for (const decision of ['accepted', 'rejected'] as const) {
    test(`A newer SQL proposal invalidates every older script run action when ${decision}`, async ({
        page,
    }, testInfo) => {
        const firstScript = 'SELECT 2 AS value;\nSELECT 3 AS value;';
        const nextScript = 'SELECT 5 AS value;\nSELECT 6 AS value;';
        const runs: Record<string, unknown>[] = [];
        page.on('request', request => {
            if (
                request.method() === 'POST' &&
                ['/api/runs', '/api/scripts'].includes(new URL(request.url()).pathname)
            )
                runs.push(jsonRecord(request.postDataJSON()));
        });
        await installProposal(page, firstScript, {
            id: 'first-script',
            summary: 'First script.',
            alternatives: [{ title: 'Another read', summary: 'Read a value.', sql: 'SELECT 4' }],
        });
        await trust(page);
        await replaceSql(page, originalSql);
        await askForChanges(page, 'First script.');
        await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
        const oldCard = page.locator('.proposal-card').first();
        const oldRunAll = oldCard.getByRole('button', {
            name: 'Run all 2 statements',
            exact: true,
        });
        const oldRunOne = oldCard.getByRole('button', {
            name: 'Run only statement 1: Read',
            exact: true,
        });
        const oldRunTwo = oldCard.getByRole('button', {
            name: 'Run only statement 2: Read',
            exact: true,
        });
        const oldAlternative = oldCard.getByRole('button', {
            name: 'Run alternative: Another read',
            exact: true,
        });
        for (const button of [oldRunAll, oldRunOne, oldRunTwo, oldAlternative])
            await expect(button).toBeEnabled();
        await installProposal(page, nextScript, { id: 'next-script', summary: 'Newer script.' });
        await askForChanges(page, 'Newer script.');
        await expect(review(page)).toBeVisible();
        for (const button of [oldRunAll, oldRunOne, oldRunTwo, oldAlternative])
            await expect(button).toBeDisabled();
        await review(page)
            .getByRole('button', {
                name: decision === 'accepted' ? 'Accept SQL changes' : 'Reject SQL changes',
                exact: true,
            })
            .click();
        await expect(review(page)).toHaveCount(0);
        for (const button of [oldRunAll, oldRunOne, oldRunTwo, oldAlternative])
            await expect(button).toBeDisabled();
        await expect(oldCard.locator('.assistant-stale-proposal')).toHaveCount(0);
        expect(runs).toHaveLength(0);
        await page.reload();
        await page.getByTestId('open-ai').click();
        for (const button of [oldRunAll, oldRunOne, oldRunTwo, oldAlternative])
            await expect(button).toBeDisabled();
        await oldRunAll.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath('superseded-script.png') });
        const latestCard = page.locator('.proposal-card').last();
        if (decision === 'accepted') {
            const latestRunAll = latestCard.getByRole('button', {
                name: 'Run all 2 statements',
                exact: true,
            });
            await expect(latestRunAll).toBeEnabled();
            await latestRunAll.click();
            await expect.poll(() => runs.length).toBe(1);
            expect(runs[0]).toMatchObject({ sql: nextScript, connectionId: 'demo' });
            await expect(
                page.getByRole('button', { name: 'Statement 2: succeeded', exact: true }),
            ).toBeVisible();
        } else {
            await expect(latestCard.getByRole('button', { name: /Run/ })).toHaveCount(0);
        }
    });
}

test('Only a newer SQL proposal invalidates an older single-query run action', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('clickstudio:experience', 'beginner'));
    await installProposal(page, proposedSql, { id: 'first-query', summary: 'First query.' });
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page, 'First query.');
    await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
    const oldRun = page
        .locator('.proposal-card')
        .first()
        .getByRole('button', { name: 'Run this query', exact: true });
    await expect(oldRun).toBeEnabled();
    await page.route('**/api/assistant/sql', route =>
        route.fulfill({
            status: 503,
            json: { error: { code: 'UNAVAILABLE', message: 'Please try again.' } },
        }),
    );
    await page.getByRole('textbox', { name: 'Ask AI', exact: true }).fill('Try a follow-up');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.assistant-turn-error').last()).toContainText('Please try again.');
    await expect(oldRun).toBeEnabled();
    await installProposal(page, null, { id: 'answer', summary: 'A text-only answer.' });
    await askForChanges(page, 'A text-only answer.');
    await expect(review(page)).toHaveCount(0);
    await expect(oldRun).toBeEnabled();
    await installProposal(page, proposedSql, { id: 'same-query', summary: 'Latest query.' });
    await askForChanges(page, 'Latest query.');
    await expect(oldRun).toBeDisabled();
    await page
        .locator('.proposal-card')
        .last()
        .getByRole('button', { name: 'Use this query', exact: true })
        .click();
    await expect(oldRun).toBeDisabled();
    await expect(
        page.locator('.proposal-card').last().getByRole('button', {
            name: 'Run this query',
            exact: true,
        }),
    ).toBeEnabled();
});

test('Rejecting SQL changes preserves the live editor and its undo history', async ({ page }) => {
    await installProposal(page);
    await trust(page);
    await replaceSql(page, originalSql);
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText(' -- keep this');
    const draft = `${originalSql} -- keep this`;
    await expect(liveEditor(page)).toHaveText(draft);
    const editor = await liveEditor(page).elementHandle();
    await askForChanges(page);
    await review(page).getByRole('button', { name: 'Reject SQL changes', exact: true }).click();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(draft);
    expect(
        await liveEditor(page).evaluate((element, original) => element === original, editor),
    ).toBe(true);
    await expect(page.getByTestId('sql-proposal-diff')).toContainText('Rejected');
    await liveEditor(page).focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(liveEditor(page)).toHaveText(originalSql);
});

test('Query ownership survives tab switches and reloads, including identical SQL', async ({
    page,
}) => {
    await installProposal(page);
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    await expect(review(page)).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'SQL documents', exact: true });
    await page.getByTestId('new-sql').click();
    await expect(review(page)).toHaveCount(0);
    await replaceSql(page, originalSql);
    await page.reload();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(originalSql);
    await page.getByTestId('open-ai').click();
    await expect(page.getByRole('button', { name: 'Apply to draft', exact: true })).toBeDisabled();
    await expect(page.locator('.assistant-sql-review')).toContainText('Open the original query');
    await tabs.getByRole('tab').first().click();
    await expect(review(page)).toBeVisible();
    await page.reload();
    await expect(review(page)).toBeVisible();
    await expect(liveEditor(page)).toHaveText(originalSql);
    await page.getByTestId('open-ai').click();
    await page.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(proposedSql);
});

test('A failed decision keeps the review and draft available for retry', async ({ page }) => {
    const fixture = await installProposal(page);
    fixture.failDecision(true);
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    const accept = review(page).getByRole('button', { name: 'Accept SQL changes', exact: true });
    await accept.click();
    await expect(review(page).getByRole('alert')).toContainText('Please try again.');
    await expect(accept).toBeEnabled();
    await expect(liveEditor(page)).toHaveText(originalSql);
    fixture.failDecision(false);
    await accept.click();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(proposedSql);
});

test('A new proposal reveals a collapsed query and still allows manual collapse', async ({
    page,
}) => {
    await installProposal(page);
    await trust(page);
    await replaceSql(page, originalSql);
    await page.getByRole('button', { name: 'Collapse SQL query', exact: true }).click();
    await askForChanges(page);
    await expect(review(page)).toBeVisible();
    await page.getByRole('button', { name: 'Collapse SQL query', exact: true }).click();
    await expect(review(page)).toBeHidden();
    await page.getByRole('button', { name: 'Expand SQL query', exact: true }).click();
    await expect(review(page)).toBeVisible();
});

test('A changed draft cannot accept a restored proposal', async ({ page }) => {
    const { decisions } = await installProposal(page);
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    await expect.poll(async () => (await storedDraft(page))?.sql).toBe(originalSql);
    await page.evaluate(() => {
        const key = 'clickstudio:workspace:demo:v1';
        const state = JSON.parse(localStorage.getItem(key)!) as {
            activeId: string;
            tabs: { id: string; sql: string }[];
        };
        const draft = state.tabs.find(tab => tab.id === state.activeId)!;
        draft.sql = 'SELECT 99 AS changed';
        localStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
    await expect(review(page)).toBeVisible();
    await expect(
        review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }),
    ).toBeDisabled();
    await expect(review(page).getByRole('alert')).toHaveText(
        'The query changed. Request a new proposal.',
    );
    await review(page).getByRole('button', { name: 'Reject SQL changes', exact: true }).click();
    await expect(liveEditor(page)).toBeVisible();
    await expect(liveEditor(page)).toHaveText('SELECT 99 AS changed');
    expect(decisions.map(item => item.decision)).toEqual(['rejected']);
});

test('Detached query review shares the same draft and decision with the workspace', async ({
    page,
}) => {
    await installProposal(page);
    await trust(page);
    await replaceSql(page, originalSql);
    const popup = page.waitForEvent('popup');
    await page
        .getByRole('button', { name: 'Open editor in a separate window', exact: true })
        .click();
    const editorWindow = await popup;
    await expect(liveEditor(editorWindow)).toBeVisible();
    await askForChanges(page);
    await expect(review(editorWindow)).toBeVisible();
    await expect(liveEditor(editorWindow)).toHaveText(originalSql);
    await review(editorWindow)
        .getByRole('button', { name: 'Accept SQL changes', exact: true })
        .click();
    await expect(review(editorWindow)).toHaveCount(0);
    await expect(liveEditor(editorWindow)).toHaveText(proposedSql);
    await expect(page.getByTestId('sql-proposal-diff')).toContainText('Applied');
    await editorWindow.getByRole('button', { name: 'Dock editor here', exact: true }).click();
    await expect.poll(() => editorWindow.isClosed()).toBe(true);
    await expect(liveEditor(page)).toHaveText(proposedSql);
});

for (const theme of ['Dark', 'Light']) {
    test(`Long SQL reviews keep restrained colors and visible decisions in ${theme} theme`, async ({
        page,
    }, testInfo) => {
        const sql = Array.from({ length: 150 }, (_, index) => `SELECT ${index + 2} AS value;`).join(
            '\n',
        );
        await installProposal(page, sql);
        await trust(page);
        await replaceSql(page, originalSql);
        await page.getByRole('radio', { name: `${theme} theme`, exact: true }).click();
        await askForChanges(page);
        const additions = review(page).locator('.cm-changedLine').first();
        const deletions = review(page).locator('.cm-deletedChunk').first();
        const expectedAdded = theme === 'Dark' ? 'rgb(16, 61, 53)' : 'rgb(204, 255, 240)';
        const expectedRemoved = theme === 'Dark' ? 'rgb(79, 39, 34)' : 'rgb(255, 231, 226)';
        await expect(additions).toHaveCSS('background-color', expectedAdded);
        await expect(deletions).toHaveCSS('background-color', expectedRemoved);
        await expect(review(page).locator('.cm-changedLineGutter').first()).toHaveCSS(
            'background-color',
            'rgb(33, 191, 150)',
        );
        await expect(review(page).locator('.cm-deletedLineGutter').first()).toHaveCSS(
            'background-color',
            'rgb(255, 101, 79)',
        );
        const accentControls = page.locator('.accent-mode-control').getByRole('button');
        for (const accent of await accentControls.all()) {
            await accent.click();
            await expect(additions).toHaveCSS('background-color', expectedAdded);
            await expect(deletions).toHaveCSS('background-color', expectedRemoved);
        }
        for (const width of [1280, 720]) {
            await page.setViewportSize({ width, height: 900 });
            const accept = review(page).getByRole('button', {
                name: 'Accept SQL changes',
                exact: true,
            });
            await expect(accept).toBeInViewport();
            await expect(review(page).locator('.cm-chunkButtons')).toHaveCount(0);
            expect(
                await review(page).evaluate(element => element.scrollWidth <= element.clientWidth),
            ).toBe(true);
            await review(page)
                .locator('.cm-scroller')
                .evaluate(element => {
                    element.scrollTop = element.scrollHeight;
                });
            await expect(accept).toBeInViewport();
            await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`) });
        }
    });
}

test('Pure deletion still opens a review and accepts an empty draft', async ({ page }) => {
    await installProposal(page, '');
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    await expect(review(page).locator('.cm-deletedChunk')).toHaveText(originalSql);
    await review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }).click();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText('');
});

test('Failed SQL checks block acceptance while allowing rejection', async ({ page }) => {
    await installProposal(page, proposedSql, {
        quality: {
            evaluatorVersion: 'test',
            evaluatedAt: '2026-10-11T00:00:00.000Z',
            status: 'fail',
            score: 0,
            checks: [],
        },
    });
    await trust(page);
    await replaceSql(page, originalSql);
    await askForChanges(page);
    await expect(
        review(page).getByRole('button', { name: 'Accept SQL changes', exact: true }),
    ).toBeDisabled();
    await expect(review(page).getByRole('alert')).toHaveText(
        'This proposal did not pass SQL checks.',
    );
    await review(page).getByRole('button', { name: 'Reject SQL changes', exact: true }).click();
    await expect(review(page)).toHaveCount(0);
    await expect(liveEditor(page)).toHaveText(originalSql);
});

for (const reply of [
    { name: 'explanations', sql: proposedSql, action: 'explain' },
    { name: 'reviews', sql: proposedSql, action: 'review' },
    { name: 'unchanged SQL', sql: originalSql, action: 'ask' },
    { name: 'answers without SQL', sql: null, action: 'ask' },
] as const) {
    test(`Inline review leaves ${reply.name} in chat`, async ({ page }) => {
        await installProposal(page, reply.sql, { action: reply.action });
        await trust(page);
        await replaceSql(page, originalSql);
        await askForChanges(page);
        await expect(review(page)).toHaveCount(0);
        await expect(liveEditor(page)).toBeVisible();
        await expect(liveEditor(page)).toHaveText(originalSql);
    });
}
