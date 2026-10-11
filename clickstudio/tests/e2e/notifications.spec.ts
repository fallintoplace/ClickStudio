import { test, expect, type Page } from '@playwright/test';
import { openBlankSql, openWorkspacePanel, replaceSql, runButton, trust } from './helpers.js';
import type { Script } from '../../src/shared/queries/execution/types.js';
import { newDraft } from '../../src/frontend/workspace/editor/drafts/workspace-state.js';

const popout = (page: Page) =>
    page.getByRole('button', { name: 'Open editor in a separate window', exact: true });

async function pendingScript(page: Page) {
    const script: Script = {
        id: 'notification-script',
        owner: 'local-owner',
        connectionId: 'demo',
        sql: 'SELECT 1; SELECT 2',
        createdAt: '2026-10-11T10:00:00.000Z',
        status: 'running',
        stopOnError: true,
        cancelled: false,
        statements: [
            { sql: 'SELECT 1', from: 0, to: 8, status: 'running' },
            { sql: 'SELECT 2', from: 10, to: 18, status: 'pending' },
        ],
    };
    await page.route('**/api/scripts', route => route.fulfill({ status: 202, json: script }));
    return script;
}

test('Repeated script poll failures stay inline and recover without a popup', async ({ page }) => {
    const script = await pendingScript(page);
    let fail = true,
        polls = 0;
    await page.route('**/api/scripts/notification-script', route => {
        polls++;
        return fail
            ? route.fulfill({
                  status: 503,
                  json: { error: { code: 'READ_FAILED', message: 'Script poll diagnostic' } },
              })
            : route.fulfill({
                  json: {
                      ...script,
                      status: 'succeeded',
                      statements: script.statements.map(statement => ({
                          ...statement,
                          status: 'succeeded',
                      })),
                  },
              });
    });
    await trust(page);
    await replaceSql(page, script.sql);
    await runButton(page).click();
    const notice = page.locator('.results-surface .workspace-inline-notice');
    await expect(notice).toContainText('Couldn’t refresh the script status. Retrying…');
    await expect.poll(() => polls).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.toast')).toHaveCount(0);
    fail = false;
    await expect(notice).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(0);
});

test('An unconfirmed cancellation warns without claiming the query stopped', async ({ page }) => {
    const script = await pendingScript(page);
    await page.route('**/api/scripts/notification-script', route =>
        route.fulfill({ json: script }),
    );
    await page.route('**/api/scripts/notification-script/cancel', route => route.abort('failed'));
    await trust(page);
    await replaceSql(page, script.sql);
    await runButton(page).click();
    await expect(runButton(page)).toHaveText('Cancel');
    await page.clock.install();
    await runButton(page).click();
    const toast = page.locator('.toast-warning');
    await expect(toast).toContainText('Couldn’t confirm cancellation. Check the query status.');
    await expect(runButton(page)).toHaveText('Cancel');
    await expect(toast.locator('pre')).not.toBeVisible();
    await page.mouse.move(0, 0);
    await page.clock.runFor(8100);
    await expect(toast).toHaveCount(0);
});

test('Trust, saving, and script completion stay quiet', async ({ page }) => {
    await trust(page);
    await expect(page.locator('.toast')).toHaveCount(0);
    await replaceSql(page, 'SELECT 101');
    const saved = page.waitForResponse(
        response =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/documents',
    );
    await page.getByTestId('save-query').click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.locator('.tab-unsaved')).toHaveCount(0);
    await expect(page.locator('.editor-surface').getByText('Saved', { exact: true })).toHaveCount(
        0,
    );
    await expect(page.locator('.toast')).toHaveCount(0);
    await replaceSql(page, 'SELECT 102');
    await expect(page.locator('.tab-unsaved')).toHaveCount(1);
    await replaceSql(page, 'SELECT 1; SELECT 2');
    await runButton(page).click();
    await expect(
        page.getByRole('button', { name: 'Statement 2: succeeded', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.toast')).toHaveCount(0);
});

for (const failure of [
    {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Couldn’t save “Getting started.sql”. Your edits are still in the draft.',
    },
    {
        status: 409,
        code: 'REVISION_CONFLICT',
        message:
            '“Getting started.sql” changed elsewhere. Review the latest version before saving.',
    },
    {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Couldn’t confirm the save of “Getting started.sql”. Check its saved version.',
    },
]) {
    test(`Save HTTP ${failure.status} stays beside its draft with collapsed diagnostics`, async ({
        page,
    }) => {
        await page.route('**/api/documents', route =>
            route.request().method() === 'POST'
                ? route.fulfill({
                      status: failure.status,
                      json: {
                          error: {
                              code: failure.code,
                              message: 'Long server diagnostic from the save endpoint',
                          },
                      },
                  })
                : route.continue(),
        );
        await trust(page);
        await replaceSql(page, 'SELECT 987');
        await page.getByTestId('save-query').click();
        const notice = page.locator('.editor-surface .workspace-inline-notice');
        await expect(notice).toContainText(failure.message);
        await expect(notice.locator('pre')).not.toBeVisible();
        await expect(page.locator('.toast')).toHaveCount(0);
        await notice.getByText('Details', { exact: true }).click();
        await expect(notice.locator('pre')).toContainText('Long server diagnostic');
        await expect(page.locator('.cm-content')).toContainText('SELECT 987');
        await page.clock.install();
        await page.clock.runFor(12000);
        await expect(notice).toBeVisible();
    });
}

test('An unconfirmed save in another tab persists and opens the affected draft', async ({
    page,
}) => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route('**/api/documents', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await pending;
        await route.abort('failed');
    });
    await trust(page);
    await replaceSql(page, 'SELECT 345');
    const saving = page.waitForRequest(
        request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/documents',
    );
    await page.getByTestId('save-query').click();
    await saving;
    await openBlankSql(page);
    release();
    const toast = page.locator('.toast-warning');
    await expect(toast).toContainText('Couldn’t confirm the save of “Getting started.sql”');
    await expect(toast.locator('.toast-timer')).toHaveCount(0);
    await expect(page.locator('.editor-surface .workspace-inline-notice')).toHaveCount(0);
    await page.clock.install();
    await page.clock.runFor(15000);
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Open tab', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('SELECT 345');
    await expect(page.locator('.editor-surface .workspace-inline-notice')).toContainText(
        'Couldn’t confirm',
    );
    await expect(page.locator('.toast')).toHaveCount(0);
});

test('Popup error timer pauses while hovered or focused and resumes its remaining time', async ({
    page,
}) => {
    await trust(page);
    await page.evaluate(() => {
        window.open = () => null;
    });
    await page.clock.install();
    await popout(page).click();
    const toast = page.locator('.toast-error');
    await expect(toast).toContainText('Editor window blocked. Allow pop-ups and try again.');
    await page.clock.runFor(3000);
    await toast.hover();
    await expect(toast.locator('.toast-timer')).toHaveCSS('animation-play-state', 'paused');
    await page.clock.runFor(9000);
    await expect(toast).toBeVisible();
    const dismiss = toast.getByRole('button', { name: 'Dismiss error', exact: true });
    await dismiss.focus();
    await page.mouse.move(0, 0);
    await page.clock.runFor(9000);
    await expect(toast).toBeVisible();
    await dismiss.blur();
    await page.clock.runFor(4000);
    await expect(toast).toBeVisible();
    await page.clock.runFor(2000);
    await expect(toast).toHaveCount(0);
});

test('Repeating the same popup error does not restart its timer', async ({ page }) => {
    await trust(page);
    await page.evaluate(() => {
        window.open = () => null;
    });
    await page.clock.install();
    await popout(page).click();
    await expect(page.locator('.toast')).toBeVisible();
    await page.clock.runFor(4000);
    await popout(page).click();
    await page.clock.runFor(3900);
    await expect(page.locator('.toast')).toBeVisible();
    await page.clock.runFor(200);
    await expect(page.locator('.toast')).toHaveCount(0);
});

test('Draft storage warning stays visible until browser storage recovers', async ({ page }) => {
    await trust(page);
    await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key.startsWith('clickstudio:workspace:'))
                throw new DOMException('Full', 'QuotaExceededError');
            original.call(this, key, value);
        };
        Object.defineProperty(window, 'restoreDraftStorage', {
            value: () => {
                Storage.prototype.setItem = original;
            },
        });
    });
    await replaceSql(page, 'SELECT 123');
    const warning = page.locator('.toast-error');
    await expect(warning).toContainText(
        'Drafts aren’t being saved in this browser. Export them before closing.',
    );
    await expect(warning.locator('.toast-timer')).toHaveCount(0);
    await page.clock.install();
    await page.clock.runFor(20000);
    await expect(warning).toBeVisible();
    await page.evaluate(() =>
        (window as unknown as { restoreDraftStorage: () => void }).restoreDraftStorage(),
    );
    await replaceSql(page, 'SELECT 124');
    await page.clock.runFor(200);
    await expect(warning).toHaveCount(0);
});

for (const panel of ['history', 'documents'] as const) {
    test(`${panel} read failure stays in its panel and Retry clears it`, async ({ page }) => {
        let fail = true;
        await page.route(
            url =>
                panel === 'history'
                    ? url.pathname === '/api/runs' && url.searchParams.has('connectionId')
                    : url.pathname === '/api/documents',
            route =>
                fail
                    ? route.fulfill({
                          status: 503,
                          json: {
                              error: { code: 'READ_FAILED', message: 'Read endpoint diagnostic' },
                          },
                      })
                    : route.fulfill({ json: [] }),
        );
        await trust(page);
        if (panel === 'history') await openWorkspacePanel(page, 'history');
        else {
            await page.getByTestId('workspace-panels').click();
            await page.getByTestId('workspace-panel-documents').click();
        }
        const inspector = page.locator('.inspector-pane');
        const notice = inspector.locator('.workspace-inline-notice');
        await expect(notice).toContainText(
            panel === 'history' ? 'Couldn’t load query history.' : 'Couldn’t load saved queries.',
        );
        await expect(
            inspector.getByText(panel === 'history' ? 'No runs yet' : 'Nothing saved yet', {
                exact: true,
            }),
        ).toHaveCount(0);
        await expect(page.locator('.toast')).toHaveCount(0);
        fail = false;
        await notice.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(notice).toHaveCount(0);
        await expect(
            inspector.getByText(panel === 'history' ? 'No runs yet' : 'Nothing saved yet', {
                exact: true,
            }),
        ).toBeVisible();
    });
}

test('A failed result read uses inline Retry and preserves the successful query outcome', async ({
    page,
}) => {
    let fail = true;
    await page.route('**/api/runs/*/result?*', route =>
        fail
            ? route.fulfill({
                  status: 503,
                  json: { error: { code: 'READ_FAILED', message: 'Rows unavailable' } },
              })
            : route.continue(),
    );
    await trust(page);
    await runButton(page).click();
    const notice = page.locator('.results-surface .workspace-inline-notice');
    await expect(notice).toContainText('Couldn’t load the result rows. Try again.');
    await expect(page.locator('.execution-bar')).toContainText('Succeeded');
    await expect(page.locator('.toast')).toHaveCount(0);
    fail = false;
    await notice.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Retained query rows' })).toBeVisible();
});

test('The tab limit uses a brief warning and keeps all existing drafts', async ({ page }) => {
    await trust(page);
    for (let count = 1; count < 30; count++) await openBlankSql(page);
    await page.clock.install();
    await openBlankSql(page);
    await expect(page.locator('.toast-warning')).toHaveText(
        '!30 tabs open. Close one to create another.',
    );
    await expect(page.getByRole('tab')).toHaveCount(30);
    await page.clock.runFor(5100);
    await expect(page.locator('.toast')).toHaveCount(0);
});

test('A long query name wraps inside a narrow toast and leaves its action usable', async ({
    page,
}) => {
    const draft = newDraft(`${'long_filename_'.repeat(12)}.sql`, 'SELECT 123');
    await page.setViewportSize({ width: 760, height: 720 });
    await page.addInitScript(draft => {
        localStorage.setItem(
            'clickstudio:workspace:demo:v1',
            JSON.stringify({ version: 1, activeId: draft.id, tabs: [draft] }),
        );
    }, draft);
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route('**/api/documents', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await pending;
        await route.abort('failed');
    });
    await trust(page);
    const saving = page.waitForRequest(
        request =>
            request.method() === 'POST' && new URL(request.url()).pathname === '/api/documents',
    );
    await page.getByTestId('save-query').click();
    await saving;
    await openBlankSql(page);
    release();
    const toast = page.locator('.toast-warning');
    await expect(toast).toContainText('long_filename_');
    expect(
        await toast
            .locator('.toast-content')
            .evaluate(element => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await toast.getByRole('button', { name: 'Open tab', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('SELECT 123');
    await expect(toast).toHaveCount(0);
});

test('A query failure after its tab closes keeps the name without a dead Open tab action', async ({
    page,
}) => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
        release = resolve;
    });
    await page.route('**/api/runs', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        await pending;
        await route.fulfill({
            status: 400,
            json: { error: { code: 'SYNTAX_ERROR', message: 'Invalid query syntax' } },
        });
    });
    await trust(page);
    const submitted = page.waitForRequest(
        request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs',
    );
    await runButton(page).click();
    await submitted;
    await openBlankSql(page);
    await page.getByRole('button', { name: 'Close Getting started.sql', exact: true }).click();
    release();
    const toast = page.locator('.toast-error');
    await expect(toast).toContainText('“Getting started.sql” failed.');
    await expect(toast.getByRole('button', { name: 'Open tab', exact: true })).toHaveCount(0);
    await expect(toast.locator('pre')).not.toBeVisible();
    await toast.getByText('Details', { exact: true }).click();
    await expect(toast.locator('pre')).toContainText('Invalid query syntax');
});
