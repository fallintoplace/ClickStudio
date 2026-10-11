export const CREATE_TABLE_COLUMN_TYPES = [
    'String',
    'Bool',
    'UInt64',
    'Int64',
    'Float64',
    'Decimal(18, 2)',
    'Date',
    'DateTime',
    'UUID',
] as const;
export type CreateTableColumnType = (typeof CREATE_TABLE_COLUMN_TYPES)[number];

export interface CreateTableColumn {
    name: string;
    type: CreateTableColumnType;
    generatedId?: boolean;
}

export function isValidTableDatabase(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 128 &&
        !value.includes('.') &&
        [...value].every(character => {
            const code = character.charCodeAt(0);
            return code >= 0x20 && code !== 0x7f;
        })
    );
}
