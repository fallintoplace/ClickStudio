import { expect, type Locator, type Page } from '@playwright/test';

export const runButton = (page: Page) => page.getByTestId('run-button');

export async function openResultFilter(target: Page | Locator) {
    await target.getByRole('button', { name: 'Filter', exact: true }).click();
    return target.getByRole('searchbox', { name: 'Filter current page', exact: true });
}

export function jsonRecord(value: unknown, label = 'JSON value'): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error(`${label} was not an object`);
    return value as Record<string, unknown>;
}

export function runIdentity(value: unknown): { id: string; queryId: string } {
    const record = jsonRecord(value, 'Run response');
    if (typeof record.id !== 'string' || typeof record.queryId !== 'string')
        throw new Error('Run response did not include string id and queryId fields');
    return { id: record.id, queryId: record.queryId };
}

export async function currentQueryId(page: Page) {
    const queryId = await page.locator('.execution-bar').getAttribute('data-query-id');
    if (!queryId) throw new Error('The execution bar has no active query ID');
    return queryId;
}

export async function openBlankSql(page: Page) {
    await page.getByTestId('new-sql').click();
    await page.getByTestId('blank-sql').click();
}

export async function replaceSql(page: Page, sql: string) {
    const editor = page.locator('.cm-content');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(sql);
    await expect
        .poll(async () => (await editor.innerText()).replace(/\s/g, ''))
        .toContain(sql.replace(/\s/g, ''));
}

type WorkspacePanel = 'history' | 'parser' | 'pipeline';

export async function openWorkspacePanel(page: Page, panel: WorkspacePanel) {
    await page.getByTestId('workspace-panels').click();
    await page.getByTestId(`workspace-panel-${panel}`).click();
}

export async function trust(page: Page) {
    await page.goto('/');
    await trustCurrentConnection(page);
    await expect(runButton(page)).toBeEnabled();
}

export async function useAdvancedMode(page: Page) {
    await page.getByText('Experimental', { exact: true }).click();
    await expect(page.locator('.workspace-root')).toHaveClass(/is-expert/);
}

export async function trustCurrentConnection(page: Page) {
    const trigger = page.locator('.connection-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();
    const details = page.getByRole('dialog', { name: 'Connection details', exact: true });
    await expect(details).toBeVisible();
    const start = details.getByRole('button', { name: 'Start exploring', exact: true });
    if (await start.isVisible()) await start.click();
    if ((await trigger.getAttribute('aria-expanded')) === 'true') await trigger.click();
}

export async function runScript(page: Page) {
    await page.getByTestId('run-button').click();
}
