import type { Copy, Locale } from './i18n-types.js';
import type { SelectOption } from './workspace-types.js';
import { english } from './i18n-english.js';
import {
    chromeTranslations,
    exampleCommonTranslations,
    explainCommonTranslations,
    objectExplorerTranslations,
    referenceCatalogTranslations,
    referenceTranslations,
    emptyWorkspaceTranslations,
    translations,
    workspaceCommonTranslations,
} from './i18n-translations.js';

export { allLocales } from './i18n-types.js';
export type { Copy, Locale } from './i18n-types.js';

export const supportedLocales = ['en', 'zh'] as const satisfies readonly Locale[];
export type Theme = 'click-dark' | 'click-light';
export type ExperienceLevel = 'beginner' | 'expert';

export const themeAppearance: Record<Theme, { dark: boolean; chromeColor: string }> = {
    'click-dark': { dark: true, chromeColor: '#151515' },
    'click-light': { dark: false, chromeColor: '#ffffff' },
};

const localeLabels: Record<Locale, string> = {
    en: 'English',
    de: 'Deutsch',
    es: 'Español',
    nl: 'Nederlands',
    zh: '中文',
    ru: 'Русский',
};

export const localeOptions = supportedLocales.map(value => ({ value, label: localeLabels[value] })) satisfies readonly SelectOption<Locale>[];

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

export const themeOptions = (copy: Copy) => [
    { value: 'click-dark', label: copy.app.darkTheme },
    { value: 'click-light', label: copy.app.lightTheme },
] as const satisfies readonly SelectOption<Theme>[];

export const experienceOptions = (copy: Copy) => [
    { value: 'beginner', label: copy.app.beginner },
    { value: 'expert', label: copy.app.expert },
] as const satisfies readonly SelectOption<ExperienceLevel>[];

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
        common: { ...mergeSection(english.common, translated), ...exampleCommonTranslations[locale], ...workspaceCommonTranslations[locale], ...referenceTranslations[locale], ...referenceCatalogTranslations[locale], ...objectExplorerTranslations[locale], ...explainCommonTranslations[locale], ...emptyWorkspaceTranslations[locale] },
        chart: mergeSection(english.chart, translated),
    };
}
