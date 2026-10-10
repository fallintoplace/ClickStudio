export const IMPORT_JOB_STATUSES = ['running', 'succeeded', 'unknown'] as const;
export type ImportJobStatus = typeof IMPORT_JOB_STATUSES[number];
