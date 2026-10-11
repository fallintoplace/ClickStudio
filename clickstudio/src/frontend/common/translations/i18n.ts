import {
    THEMES,
    EXPERIENCE_LEVELS,
    type Theme,
    type ExperienceLevel,
} from '../styles/appearance-types.js';
import type { Copy, Locale } from './i18n-types.js';
import type { SelectOption } from '../../workspace/workspace-types.js';
import { english } from './i18n-english.js';
import {
    chromeTranslations,
    exampleCommonTranslations,
    explainCommonTranslations,
    objectExplorerTranslations,
    referenceCatalogTranslations,
    referenceTranslations,
    emptyWorkspaceTranslations,
    importTranslations,
    translations,
    workspaceCommonTranslations,
} from './i18n-translations.js';

export { allLocales } from './i18n-types.js';
export type { Copy, Locale } from './i18n-types.js';

export const supportedLocales = ['en', 'zh'] as const satisfies readonly Locale[];
export type { Theme, ExperienceLevel } from '../styles/appearance-types.js';

export const themeAppearance: Record<Theme, { dark: boolean; chromeColor: string }> = {
    'click-dark': { dark: true, chromeColor: '#151515' },
    'click-light': { dark: false, chromeColor: '#ffffff' },
};

export function resolveLocale(...candidates: readonly (string | null | undefined)[]): Locale {
    for (const candidate of candidates) {
        const normalized = candidate?.trim().toLowerCase().replaceAll('_', '-');
        if (!normalized) continue;
        const exact = supportedLocales.find(locale => locale === normalized);
        if (exact) return exact;
        const [primary] = normalized.split('-');
        const regional = supportedLocales.find(locale => locale === primary);
        if (regional) return regional;
    }
    return 'en';
}

export const themeOptions = (copy: Copy): readonly SelectOption<Theme>[] =>
    THEMES.map(value => ({
        value,
        label: value === 'click-dark' ? copy.app.darkTheme : copy.app.lightTheme,
    }));

export const experienceOptions = (copy: Copy): readonly SelectOption<ExperienceLevel>[] =>
    EXPERIENCE_LEVELS.map(value => ({
        value,
        label: copy.app[value],
    }));

function mergeSection<T extends object>(englishSection: T, translated: object): T {
    const result = { ...englishSection };
    const values = new Map<string, unknown>(Object.entries(translated));
    for (const key of Object.keys(englishSection)) {
        const value = values.get(key);
        if (typeof value === 'string') Object.assign(result, { [key]: value });
    }
    return result;
}

export function getCopy(locale: Locale): Copy {
    if (locale === 'en') return english;
    const translated = translations[locale];
    const chrome = chromeTranslations[locale];
    return {
        app: { ...mergeSection(english.app, translated), ...chrome.app },
        auth: { ...mergeSection(english.auth, translated), ...chrome.auth },
        imports: mergeSection(english.imports, importTranslations[locale] ?? {}),
        common: {
            ...mergeSection(english.common, translated),
            ...exampleCommonTranslations[locale],
            ...workspaceCommonTranslations[locale],
            ...referenceTranslations[locale],
            ...referenceCatalogTranslations[locale],
            ...objectExplorerTranslations[locale],
            ...explainCommonTranslations[locale],
            ...emptyWorkspaceTranslations[locale],
        },
        chart: mergeSection(english.chart, translated),
    };
}
