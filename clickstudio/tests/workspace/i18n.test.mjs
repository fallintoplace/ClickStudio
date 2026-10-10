import assert from 'node:assert/strict';
import test from 'node:test';

const { allLocales, getCopy, resolveLocale, supportedLocales, themeOptions } =
    await import('../../.workspace-build/web/i18n.js');

const nonEnglishLocales = supportedLocales.filter(locale => locale !== 'en');

test('Locale dictionaries match the supported application locales', () => {
    assert.deepEqual(supportedLocales, ['en', 'zh']);
    assert.deepEqual(allLocales, supportedLocales);
});

test('Browser locale resolution accepts regional tags and safe fallbacks', () => {
    assert.equal(resolveLocale('de-DE'), 'en');
    assert.equal(resolveLocale('zh_Hant_TW'), 'zh');
    assert.equal(resolveLocale('fr-FR', 'es-MX'), 'en');
    assert.equal(resolveLocale('ru'), 'en');
    assert.equal(resolveLocale('', null, undefined, 'pt-BR'), 'en');
    assert.equal(resolveLocale('  ZH-hant-TW  '), 'zh');
    assert.equal(resolveLocale('en-GB', 'zh'), 'en');
});

for (const locale of ['de', 'es', 'nl', 'ru']) {
    test(`Retired stored locale ${locale} falls back to the browser locale`, () => {
        assert.equal(resolveLocale(locale, 'zh-CN', 'en-US'), 'zh');
        assert.equal(resolveLocale(`${locale}_${locale.toUpperCase()}`, 'en-US'), 'en');
        assert.equal(resolveLocale(locale), 'en');
    });
}

test('Authentication and theme chrome is localized for every selectable locale', () => {
    const english = getCopy('en');
    const englishThemes = themeOptions(english);

    for (const locale of nonEnglishLocales) {
        const copy = getCopy(locale);
        assert.notEqual(copy.auth.privateWorkspace, english.auth.privateWorkspace, `${locale} private workspace`);
        assert.notEqual(copy.auth.unavailable, english.auth.unavailable, `${locale} unavailable`);
        assert.notEqual(copy.auth.retry, english.auth.retry, `${locale} retry`);
        assert.notEqual(copy.auth.credentialsNotice, english.auth.credentialsNotice, `${locale} credentials notice`);
        assert.notEqual(copy.app.accent, english.app.accent, `${locale} accent label`);
        assert.notEqual(copy.app.cyanAccent, english.app.cyanAccent, `${locale} cyan accent label`);
        assert.notEqual(copy.app.clickhouseYellowAccent, english.app.clickhouseYellowAccent, `${locale} ClickHouse yellow accent label`);
        const localizedThemes = themeOptions(copy);
        assert.notEqual(localizedThemes[0].label, englishThemes[0].label, `${locale} dark theme`);
        assert.notEqual(localizedThemes[1].label, englishThemes[1].label, `${locale} light theme`);
    }
});

function flattenStrings(value, prefix = '') {
    const result = new Map();
    for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof child === 'string') result.set(path, child);
        else if (child && typeof child === 'object') {
            for (const [nestedPath, text] of flattenStrings(child, path)) result.set(nestedPath, text);
        }
    }
    return result;
}

function placeholders(value) {
    return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort();
}

test('Localized copy preserves the English key shape and placeholder contracts', () => {
    const english = flattenStrings(getCopy('en'));
    const englishPaths = [...english.keys()].sort();

    for (const locale of allLocales) {
        const localized = flattenStrings(getCopy(locale));
        assert.deepEqual([...localized.keys()].sort(), englishPaths, `${locale} copy shape`);
        for (const [path, englishText] of english) {
            assert.deepEqual(placeholders(localized.get(path) ?? ''), placeholders(englishText), `${locale}.${path}`);
        }
    }
});

test('Import review copy is translated for Chinese', () => {
    const english = getCopy('en').imports;
    const chinese = getCopy('zh').imports;

    assert.notEqual(chinese.reviewOmittedTargets, english.reviewOmittedTargets);
    assert.notEqual(chinese.reviewMissingValues, english.reviewMissingValues);
    assert.equal(chinese.inputRow, '行');
    assert.equal(chinese.inputRows, '行');
});
