import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const referenceCss = gunzipSync(
    readFileSync(new URL('../fixtures/styles/reference.css.gz', import.meta.url)),
).toString();

async function visibleStyles(page: Page) {
    return page.evaluate(() => {
        const properties = [
            'display',
            'visibility',
            'opacity',
            'position',
            'z-index',
            'width',
            'height',
            'min-width',
            'max-width',
            'min-height',
            'max-height',
            'top',
            'right',
            'bottom',
            'left',
            'content',
            'overflow-x',
            'overflow-y',
            'color',
            'background-color',
            'background-image',
            'background-size',
            'background-clip',
            'border-color',
            'border-width',
            'border-style',
            'border-radius',
            'outline-color',
            'outline-width',
            'outline-style',
            'outline-offset',
            'box-shadow',
            'text-shadow',
            'font-family',
            'font-size',
            'font-weight',
            'line-height',
            'letter-spacing',
            'text-align',
            'text-decoration',
            'padding',
            'margin',
            'gap',
            'grid-template-columns',
            'grid-template-rows',
            'transform',
            'filter',
            'backdrop-filter',
            'clip-path',
            'mask-image',
            'fill',
            'fill-opacity',
            'stroke',
            'stroke-width',
            'stroke-opacity',
        ];
        const entries = [];
        for (const element of document.body.querySelectorAll('*')) {
            const bounds = element.getBoundingClientRect();
            if (!bounds.width || !bounds.height) continue;
            let visible = true;
            for (
                let ancestor: Element | null = element;
                ancestor;
                ancestor = ancestor.parentElement
            ) {
                const style = getComputedStyle(ancestor);
                if (style.visibility !== 'visible' || style.opacity === '0') {
                    visible = false;
                    break;
                }
            }
            if (!visible) continue;
            const pseudos: (string | null)[] = [null, '::before', '::after'];
            if (element instanceof HTMLInputElement && element.type === 'file')
                pseudos.push('::file-selector-button');
            if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
                pseudos.push('::placeholder');
            for (const pseudo of pseudos) {
                const style = getComputedStyle(element, pseudo);
                if (
                    (pseudo === '::before' || pseudo === '::after') &&
                    ['none', 'normal'].includes(style.content)
                )
                    continue;
                entries.push({
                    tag: element.tagName,
                    class: element.getAttribute('class'),
                    pseudo,
                    bounds: [bounds.x, bounds.y, bounds.width, bounds.height],
                    styles: Object.fromEntries(
                        properties.map(property => [property, style.getPropertyValue(property)]),
                    ),
                });
            }
        }
        return entries;
    });
}

export async function expectReferenceStyles(
    page: Page,
    info: TestInfo,
    name: string,
    target: Page | Locator = page,
    resetMouse = true,
) {
    await page.evaluate(() => document.fonts.ready);
    if (resetMouse) await page.mouse.move(0, 0);
    const options = { animations: 'disabled' as const, caret: 'hide' as const };
    // Keep runtime editor styles. Replace only Vite's static stylesheet imports.
    const reference = await page.evaluateHandle(css => {
        const sheets = [
            ...document.querySelectorAll<HTMLStyleElement>('style[data-vite-dev-id]'),
        ].map(style => ({ sheet: style.sheet!, disabled: style.sheet!.disabled }));
        const style = document.createElement('style');
        style.textContent = css;
        document.head.append(style);
        for (const { sheet } of sheets) sheet.disabled = true;
        return { style, sheets };
    }, referenceCss);
    let expected: Buffer;
    let expectedStyles: Awaited<ReturnType<typeof visibleStyles>>;
    try {
        expected = await target.screenshot(options);
        expectedStyles = await visibleStyles(page);
    } finally {
        await reference.evaluate(({ style, sheets }) => {
            for (const { sheet, disabled } of sheets) sheet.disabled = disabled;
            style.remove();
        });
        await reference.dispose();
    }
    const actual = await target.screenshot(options);
    const actualStyles = await visibleStyles(page);
    const currentImage = PNG.sync.read(actual),
        referenceImage = PNG.sync.read(expected);
    const dimensions = { width: currentImage.width, height: currentImage.height };
    const referenceDimensions = { width: referenceImage.width, height: referenceImage.height };
    await info.attach(`${name}-current`, { body: actual, contentType: 'image/png' });
    await info.attach(`${name}-reference`, { body: expected, contentType: 'image/png' });
    expect(dimensions, `${name}: dimensions`).toEqual(referenceDimensions);
    const diff = new PNG(dimensions);
    const changed = pixelmatch(
        currentImage.data,
        referenceImage.data,
        diff.data,
        dimensions.width,
        dimensions.height,
        { threshold: 0.1 },
    );
    if (changed) {
        writeFileSync(info.outputPath(`${name}-current.png`), actual);
        writeFileSync(info.outputPath(`${name}-reference.png`), expected);
        const path = info.outputPath(`${name}-diff.png`);
        writeFileSync(path, PNG.sync.write(diff));
        await info.attach(`${name}-diff`, { path, contentType: 'image/png' });
    }
    expect(actualStyles, `${name}: computed colors and layout`).toEqual(expectedStyles);
    expect(changed, `${name}: changed pixels`).toBe(0);
}
