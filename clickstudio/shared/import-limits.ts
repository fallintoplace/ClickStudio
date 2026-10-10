export const IMPORT_FORMATS = ['csv', 'json', 'ndjson'] as const;
export type ImportFormat = typeof IMPORT_FORMATS[number];

export const MAX_IMPORT_FILE_BYTES = 2_000_000;
export const MAX_IMPORT_SOURCE_CHARS = 2_000_000;
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_COLUMNS = 200;
export const MAX_IMPORT_COLUMN_NAME_CHARS = 256;
export const IMPORT_PREVIEW_ROWS = 20;
export const IMPORT_FILE_SIZE_LABEL = `${MAX_IMPORT_FILE_BYTES / 1_000_000} MB`;
export const IMPORT_ROW_LIMIT_LABEL = MAX_IMPORT_ROWS.toLocaleString('en-US');
