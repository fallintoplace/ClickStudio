import { test, expect, type Page } from '@playwright/test';

const themes = [
    {
        value: 'click-dark',
        dark: true,
        surface: '#0c151c',
        panel: '#14232d',
        accent: '#68e5ff',
        action: '#68e5ff',
        yellowAccent: '#faff69',
        yellowAction: '#faff69',
        chrome: '#151515',
        logoColor: '#fff',
    },
    {
        value: 'click-light',
        dark: false,
        surface: '#edf4f6',
        panel: '#fcfeff',
        accent: '#08758d',
        action: '#08758d',
        yellowAccent: '#6b6c00',
        yellowAction: '#faff69',
        chrome: '#ffffff',
        logoColor: '#161616',
    },
] as const;

function themeOption(page: Page, value: string) {
    const label = value === 'click-dark' ? 'Dark theme' : 'Light theme';
    return page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: label });
}

function accentOption(page: Page, value: 'cyan' | 'clickhouse-yellow') {
    const label = value === 'cyan' ? 'Cyan accent' : 'ClickHouse yellow accent';
    return page.getByRole('group', { name: 'Accent color' }).getByRole('button', { name: label });
}

for (const theme of themes) test(`${theme.value} applies its palette and survives reload`, async ({ page }) => {
    await page.goto('/');
    const option = themeOption(page, theme.value);
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.value);
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'cyan');
    await expect(accentOption(page, 'cyan')).toHaveAttribute('aria-pressed', 'true');

    const palette = await page.locator('html').evaluate(element => {
        const styles = getComputedStyle(element);
        return {
            colorScheme: styles.colorScheme,
            surface: styles.getPropertyValue('--page').trim(),
            panel: styles.getPropertyValue('--panel').trim(),
            accent: styles.getPropertyValue('--accent').trim(),
            action: styles.getPropertyValue('--accent-action').trim(),
        };
    });
    expect(palette.colorScheme).toBe(theme.dark ? 'dark' : 'light');
    expect(palette.surface).toBe(theme.surface);
    expect(palette.panel).toBe(theme.panel);
    expect(palette.accent).toBe(theme.accent);
    expect(palette.action).toBe(theme.action);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', theme.chrome);
    const logoSvg = await page.locator('.brand-symbol').evaluate(image => decodeURIComponent(image.getAttribute('src')?.split(',')[1] ?? ''));
    expect(logoSvg).toContain(`fill: ${theme.logoColor}`);

    await page.reload();
    await expect(themeOption(page, theme.value)).toBeChecked();
    await expect(accentOption(page, 'cyan')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.value);
});

for (const theme of themes) test(`${theme.value} supports the ClickHouse yellow accent`, async ({ page }) => {
    await page.goto('/');
    await themeOption(page, theme.value).click();
    const option = accentOption(page, 'clickhouse-yellow');
    await option.click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'clickhouse-yellow');

    const palette = await page.locator('html').evaluate(element => {
        const styles = getComputedStyle(element);
        return {
            accent: styles.getPropertyValue('--accent').trim(),
            action: styles.getPropertyValue('--accent-action').trim(),
        };
    });
    expect(palette.accent).toBe(theme.yellowAccent);
    expect(palette.action).toBe(theme.yellowAction);

    await page.reload();
    await expect(themeOption(page, theme.value)).toBeChecked();
    await expect(accentOption(page, 'clickhouse-yellow')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'clickhouse-yellow');
});

test('an unknown saved theme falls back to ClickDark', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('clickstudio:theme', 'future-theme');
        localStorage.setItem('clickstudio:accent', 'future-accent');
    });
    await page.goto('/');
    await expect(themeOption(page, 'click-dark')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'click-dark');
    await expect(accentOption(page, 'cyan')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'cyan');
});

for (const removedTheme of ['monokai', 'catppuccin-latte']) test(`a saved ${removedTheme} preference falls back to ClickDark`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('clickstudio:theme', value), removedTheme);
    await page.goto('/');
    await expect(themeOption(page, 'click-dark')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'click-dark');
});

test('localized desktop header keeps the theme switch in view', async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 900 });
    await page.goto('/');

    const topbar = page.locator('.topbar');
    const themeSwitch = page.locator('.theme-mode-control');
    const accentSwitch = page.locator('.accent-mode-control');

    for (const locale of ['en', 'zh']) {
        await page.evaluate(value => localStorage.setItem('clickstudio:locale', value), locale);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('.topbar-preferences select')).toHaveCount(0);
        await expect(themeSwitch).toBeVisible();
        await expect(accentSwitch).toBeVisible();

        const headerSize = await topbar.evaluate(element => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
        }));
        expect(headerSize.scrollWidth, `${locale} header overflow`).toBeLessThanOrEqual(headerSize.clientWidth);

        const themeBounds = await themeSwitch.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
        });
        expect(themeBounds.left, `${locale} theme switch left edge`).toBeGreaterThanOrEqual(0);
        expect(themeBounds.right, `${locale} theme switch right edge`).toBeLessThanOrEqual(themeBounds.viewportWidth);

        const accentBounds = await accentSwitch.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
        });
        expect(accentBounds.left, `${locale} accent switch left edge`).toBeGreaterThanOrEqual(0);
        expect(accentBounds.right, `${locale} accent switch right edge`).toBeLessThanOrEqual(accentBounds.viewportWidth);
    }
});
