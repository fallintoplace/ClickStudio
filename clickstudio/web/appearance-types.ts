export const THEMES = ['click-dark', 'click-light'] as const;
export type Theme = (typeof THEMES)[number];

export const EXPERIENCE_LEVELS = ['beginner', 'expert'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const ACCENT_CHOICES = ['cyan', 'clickhouse-yellow'] as const;
export type AccentChoice = (typeof ACCENT_CHOICES)[number];

export const PARSER_MODES = ['wasm', 'basic'] as const;
export type ParserMode = (typeof PARSER_MODES)[number];
