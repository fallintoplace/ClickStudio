import type { english } from './i18n-english.js';

export const allLocales = ['en', 'de', 'es', 'nl', 'zh', 'ru'] as const;
export type Locale = (typeof allLocales)[number];

type WidenStrings<T> = T extends string
    ? string
    : T extends object
        ? { -readonly [Key in keyof T]: WidenStrings<T[Key]> }
        : T;

export type Copy = WidenStrings<typeof english>;
