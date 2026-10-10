import {
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { CREATE_TABLE_COLUMN_TYPES, type CreateTableColumn } from '../../shared/table-creation';
import type { Connected } from '../workspace-types';
import { message, post } from '../api';
import { CLICKHOUSE_CLOUD_CONNECTION_ID, createClickHouseCloudTable } from '../cloud-connection';
import { Icon } from './ui';

type Props = {
    connection: Connected;
    databases: readonly string[];
    onClose: () => void;
    onCreated: (target: { database: string; table: string }) => void;
};

const firstColumn: CreateTableColumn = { name: 'id', type: 'UInt64', generatedId: true };
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const identifierPatternAttribute = '[A-Za-z_][A-Za-z0-9_]{0,127}';

export function CreateTableDialog({ connection, databases, onClose, onCreated }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const databaseInput = useRef<HTMLInputElement>(null);
    const tableInput = useRef<HTMLInputElement>(null);
    const databaseOptionsId = `create-table-databases-${useId()}`;
    const databaseInputId = `${databaseOptionsId}-input`;
    const [database, setDatabase] = useState(connection.database);
    const [table, setTable] = useState('');
    const [columns, setColumns] = useState<CreateTableColumn[]>([firstColumn]);
    const [orderBy, setOrderBy] = useState(firstColumn.name);
    const [busy, setBusy] = useState(false);
    const [created, setCreated] = useState(false);
    const [error, setError] = useState('');
    const [databaseTouched, setDatabaseTouched] = useState(false);
    const [tableTouched, setTableTouched] = useState(false);
    const [databaseOptionsOpen, setDatabaseOptionsOpen] = useState(false);
    const [activeDatabaseOption, setActiveDatabaseOption] = useState(-1);
    const [databaseOptionsQuery, setDatabaseOptionsQuery] = useState('');
    const targetTable = useMemo(() => `${database.trim()}.${table.trim()}`, [database, table]);
    const databaseIsValid = identifierPattern.test(database);
    const tableIsValid = identifierPattern.test(table);
    const columnsAreValid = columns.every(column => identifierPattern.test(column.name));
    const columnNamesAreUnique =
        new Set(columns.map(column => column.name)).size === columns.length;
    const canCreate =
        databaseIsValid &&
        tableIsValid &&
        columnsAreValid &&
        columnNamesAreUnique &&
        Boolean(orderBy);
    const databaseOptions = useMemo(() => {
        const query = databaseOptionsQuery.trim().toLowerCase();
        return [...new Set([connection.database, ...databases])].filter(
            name =>
                Boolean(name) && identifierPattern.test(name) && name.toLowerCase().includes(query),
        );
    }, [connection.database, databases, databaseOptionsQuery]);
    const highlightedDatabaseOption =
        activeDatabaseOption >= 0 && activeDatabaseOption < databaseOptions.length
            ? activeDatabaseOption
            : -1;

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        element.showModal();
        tableInput.current?.focus({ preventScroll: true });
        return () => {
            if (element.open) element.close();
        };
    }, []);

    useEffect(() => {
        if (!columns.some(column => column.name === orderBy)) setOrderBy(columns[0]?.name ?? '');
    }, [columns, orderBy]);

    useEffect(() => {
        if (!databaseOptionsOpen || highlightedDatabaseOption < 0) return;
        document
            .getElementById(`${databaseOptionsId}-option-${highlightedDatabaseOption}`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [databaseOptionsId, databaseOptionsOpen, highlightedDatabaseOption]);

    function updateColumn(index: number, field: keyof CreateTableColumn, value: string) {
        setColumns(current =>
            current.map((column, item) => {
                if (item !== index) return column;
                const next = { ...column, [field]: value } as CreateTableColumn;
                if (next.name !== 'id' || next.type !== 'UInt64') delete next.generatedId;
                return next;
            }),
        );
    }

    function selectDatabase(value: string) {
        setDatabase(value);
        setDatabaseOptionsQuery('');
        setDatabaseTouched(false);
        setDatabaseOptionsOpen(false);
        setActiveDatabaseOption(-1);
        databaseInput.current?.focus();
    }

    function handleDatabaseKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setDatabaseOptionsOpen(true);
            setActiveDatabaseOption(current => {
                if (databaseOptions.length === 0) {
                    return -1;
                }

                if (current < 0 || current >= databaseOptions.length - 1) {
                    return 0;
                }

                return current + 1;
            });
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setDatabaseOptionsOpen(true);
            setActiveDatabaseOption(current => {
                if (databaseOptions.length === 0) {
                    return -1;
                }

                if (current <= 0 || current >= databaseOptions.length) {
                    return databaseOptions.length - 1;
                }

                return current - 1;
            });
        } else if (event.key === 'Enter' && databaseOptionsOpen) {
            event.preventDefault();
            const selectedDatabase = databaseOptions[highlightedDatabaseOption];
            if (selectedDatabase) selectDatabase(selectedDatabase);
            else setDatabaseOptionsOpen(false);
        } else if (event.key === 'Escape' && databaseOptionsOpen) {
            event.preventDefault();
            event.stopPropagation();
            setDatabaseOptionsOpen(false);
            setActiveDatabaseOption(-1);
        }
    }

    async function create(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !canCreate) return;
        setBusy(true);
        setError('');
        try {
            if (connection.id === CLICKHOUSE_CLOUD_CONNECTION_ID) {
                await createClickHouseCloudTable({
                    database: database.trim(),
                    name: table.trim(),
                    columns,
                    orderBy,
                });
            } else {
                await post(`/connections/${encodeURIComponent(connection.id)}/tables`, {
                    database: database.trim(),
                    table: table.trim(),
                    columns,
                    orderBy,
                });
            }
            setCreated(true);
            onCreated({ database: database.trim(), table: table.trim() });
        } catch (caught) {
            setError(message(caught));
        } finally {
            setBusy(false);
        }
    }

    let databaseHelp:
        | 'Use letters, numbers, and underscores. Start with a letter or _.'
        | 'Choose or type a database name.'
        | 'Choose a database or type its name.';

    if (databaseTouched && !databaseIsValid) {
        if (database) {
            databaseHelp = 'Use letters, numbers, and underscores. Start with a letter or _.';
        } else {
            databaseHelp = 'Choose or type a database name.';
        }
    } else {
        databaseHelp = 'Choose a database or type its name.';
    }
    let tableHelp: string;

    if (tableTouched && !tableIsValid) {
        if (table) {
            tableHelp = 'Use letters, numbers, and underscores. Start with a letter or _.';
        } else {
            tableHelp = 'A table name is required.';
        }
    } else if (table) {
        tableHelp = 'Names can use letters, numbers, and underscores.';
    } else {
        tableHelp = 'Enter a table name to enable Create table.';
    }
    let createDisabledReason: string;

    if (!databaseIsValid) {
        createDisabledReason = 'Select or type a valid database name.';
    } else if (!tableIsValid) {
        if (table) {
            createDisabledReason = 'Use a valid table name to continue.';
        } else {
            createDisabledReason = 'Enter a table name to continue.';
        }
    } else if (!columnsAreValid) {
        createDisabledReason = 'Give each column a valid name.';
    } else if (!columnNamesAreUnique) {
        createDisabledReason = 'Column names must be unique.';
    } else if (!orderBy) {
        createDisabledReason = 'Choose a sorting key to continue.';
    } else {
        createDisabledReason = '';
    }

    return (
        <dialog
            ref={dialog}
            aria-labelledby="create-table-title"
            onCancel={event => {
                event.preventDefault();
                if (!busy) onClose();
            }}
            onClick={event => {
                if (event.target === dialog.current && !busy) onClose();
            }}
            className="create-table-dialog m-auto max-w-none overflow-hidden rounded-2xl border border-[var(--line-bright)] bg-[var(--panel)] p-0 text-[var(--text)] shadow-[var(--shadow-dialog)]"
        >
            <form onSubmit={event => void create(event)} className="create-table-form">
                <header className="create-table-header flex items-start justify-between gap-5 border-b border-[var(--line)] px-5 py-4 sm:px-7">
                    <div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                            ClickHouse
                        </span>
                        <h2
                            id="create-table-title"
                            className="mt-1 text-lg font-semibold tracking-tight"
                        >
                            New table
                        </h2>
                        <p className="mt-1 text-xs text-[var(--text-soft)]">
                            Create an empty MergeTree table in{' '}
                            <code>{database || 'a database'}</code>.
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="Close new table"
                        disabled={busy}
                        onClick={onClose}
                        className="create-table-close rounded-lg border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-soft)] disabled:opacity-40"
                    >
                        Close
                    </button>
                </header>

                <main className="create-table-content min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
                    {!created && (
                        <>
                            {renderDatabasePicker({
                                databaseInputId,
                                databaseInput,
                                databaseTouched,
                                databaseIsValid,
                                databaseOptionsOpen,
                                databaseOptionsId,
                                highlightedDatabaseOption,
                                database,
                                setDatabaseOptionsOpen,
                                setDatabaseOptionsQuery,
                                setActiveDatabaseOption,
                                setDatabaseTouched,
                                setDatabase,
                                handleDatabaseKeyDown,
                                databaseOptions,
                                selectDatabase,
                                databaseHelp,
                            })}

                            <label className="create-table-field">
                                <span>Table name</span>
                                <input
                                    ref={tableInput}
                                    aria-label="Table name"
                                    aria-describedby="create-table-name-help create-table-target"
                                    aria-invalid={tableTouched && !tableIsValid}
                                    value={table}
                                    onChange={event => setTable(event.target.value)}
                                    onBlur={() => setTableTouched(true)}
                                    required
                                    maxLength={128}
                                    pattern={identifierPatternAttribute}
                                    placeholder="e.g. events"
                                    className="create-table-control font-mono"
                                />
                                <span
                                    id="create-table-name-help"
                                    className={`create-table-help${tableTouched && !tableIsValid ? ' is-error' : ''}`}
                                >
                                    {tableHelp}
                                </span>
                                <span id="create-table-target" className="create-table-target">
                                    <span>Destination</span>
                                    <code>
                                        {database.trim() || '<database>'}.
                                        {table.trim() || '<table_name>'}
                                    </code>
                                </span>
                            </label>

                            {renderTableColumns({ setColumns, columns, updateColumn })}

                            <label className="create-table-field">
                                <span>Sorting key</span>
                                <span className="create-table-select-wrap">
                                    <select
                                        aria-label="Sorting key"
                                        aria-describedby="create-table-sorting-help"
                                        value={orderBy}
                                        onChange={event => setOrderBy(event.target.value)}
                                        className="create-table-control create-table-select"
                                    >
                                        {columns.map((column, index) => (
                                            <option
                                                key={`${column.name}-${index}`}
                                                value={column.name}
                                            >
                                                {column.name || `Column ${index + 1}`}
                                            </option>
                                        ))}
                                    </select>
                                    <Icon name="chevron" />
                                </span>
                                <span id="create-table-sorting-help" className="create-table-help">
                                    Used to organize data for queries. The first column is selected
                                    by default.
                                </span>
                            </label>
                            <p className="create-table-supported-types">
                                Available types: String, Bool, UInt64, Int64, Float64, Decimal(18,
                                2), Date, DateTime, UUID.
                            </p>
                        </>
                    )}
                    {created && (
                        <p
                            role="status"
                            className="rounded-xl border border-[var(--green)]/30 bg-[var(--green)]/5 p-4 text-sm"
                        >
                            Created <code>{targetTable}</code>.
                        </p>
                    )}
                    {error && (
                        <p
                            role="alert"
                            className="rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-2.5 text-xs text-[var(--red)]"
                        >
                            {error}
                        </p>
                    )}
                </main>

                <footer className="create-table-footer flex justify-end gap-2 border-t border-[var(--line)] bg-[var(--page)] px-5 py-3 sm:px-7">
                    {!created && !canCreate && !busy && (
                        <p className="create-table-submit-help">{createDisabledReason}</p>
                    )}
                    {created ? (
                        <button
                            type="button"
                            onClick={onClose}
                            className="create-table-button rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)]"
                        >
                            Done
                        </button>
                    ) : (
                        <button
                            type="submit"
                            disabled={busy || !canCreate}
                            className="create-table-button rounded-lg bg-[var(--accent-action)] px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {busy ? 'Creating…' : 'Create table'}
                        </button>
                    )}
                </footer>
            </form>
        </dialog>
    );
}

function renderTableColumns({
    setColumns,
    columns,
    updateColumn,
}: {
    setColumns: import('react').Dispatch<import('react').SetStateAction<CreateTableColumn[]>>;
    columns: CreateTableColumn[];
    updateColumn: (index: number, field: keyof CreateTableColumn, value: string) => void;
}) {
    return (
        <section aria-label="Table columns" className="create-table-columns space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold">Columns</h3>
                <button
                    type="button"
                    onClick={() =>
                        setColumns(current => [
                            ...current,
                            {
                                name: `column_${current.length + 1}`,
                                type: 'String',
                            },
                        ])
                    }
                    disabled={columns.length >= 50}
                    className="create-table-secondary-button rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs disabled:opacity-40"
                >
                    Add column
                </button>
            </div>
            {columns.map((column, index) => (
                <div
                    key={index}
                    className={`create-table-column-row grid grid-cols-[minmax(0,1fr)_minmax(8rem,.8fr)_auto] gap-2 rounded-lg border border-[var(--line)] bg-[var(--page)] p-3${column.generatedId ? ' has-generated-id' : ''}`}
                >
                    <label className="create-table-column-field">
                        <span className="create-table-column-label">Name</span>
                        <input
                            aria-label={`Column ${index + 1} name`}
                            aria-invalid={!identifierPattern.test(column.name)}
                            value={column.name}
                            onChange={event => updateColumn(index, 'name', event.target.value)}
                            required
                            maxLength={128}
                            pattern={identifierPatternAttribute}
                            className="create-table-control create-table-column-control font-mono"
                        />
                        {column.generatedId && (
                            <span className="create-table-generated-id">
                                Generated by ClickHouse when omitted
                            </span>
                        )}
                    </label>
                    <label className="create-table-column-field">
                        <span className="create-table-column-label">Type</span>
                        <span className="create-table-select-wrap">
                            <select
                                aria-label={`Column ${index + 1} type`}
                                value={column.type}
                                onChange={event => updateColumn(index, 'type', event.target.value)}
                                className="create-table-control create-table-column-control create-table-select"
                            >
                                {CREATE_TABLE_COLUMN_TYPES.map(type => (
                                    <option key={type} value={type}>
                                        {type}
                                    </option>
                                ))}
                            </select>
                            <Icon name="chevron" />
                        </span>
                    </label>
                    <button
                        type="button"
                        aria-label={`Remove ${column.name || `column ${index + 1}`}`}
                        disabled={columns.length === 1}
                        onClick={() =>
                            setColumns(current => current.filter((_, item) => item !== index))
                        }
                        className="create-table-secondary-button create-table-remove rounded-md border border-[var(--line)] px-2 text-xs disabled:opacity-30"
                    >
                        Remove
                    </button>
                </div>
            ))}
        </section>
    );
}

function renderDatabasePicker({
    databaseInputId,
    databaseInput,
    databaseTouched,
    databaseIsValid,
    databaseOptionsOpen,
    databaseOptionsId,
    highlightedDatabaseOption,
    database,
    setDatabaseOptionsOpen,
    setDatabaseOptionsQuery,
    setActiveDatabaseOption,
    setDatabaseTouched,
    setDatabase,
    handleDatabaseKeyDown,
    databaseOptions,
    selectDatabase,
    databaseHelp,
}: {
    databaseInputId: string;
    databaseInput: import('react').RefObject<HTMLInputElement | null>;
    databaseTouched: boolean;
    databaseIsValid: boolean;
    databaseOptionsOpen: boolean;
    databaseOptionsId: string;
    highlightedDatabaseOption: number;
    database: string;
    setDatabaseOptionsOpen: import('react').Dispatch<import('react').SetStateAction<boolean>>;
    setDatabaseOptionsQuery: import('react').Dispatch<import('react').SetStateAction<string>>;
    setActiveDatabaseOption: import('react').Dispatch<import('react').SetStateAction<number>>;
    setDatabaseTouched: import('react').Dispatch<import('react').SetStateAction<boolean>>;
    setDatabase: import('react').Dispatch<import('react').SetStateAction<string>>;
    handleDatabaseKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
    databaseOptions: string[];
    selectDatabase: (value: string) => void;
    databaseHelp:
        | 'Use letters, numbers, and underscores. Start with a letter or _.'
        | 'Choose or type a database name.'
        | 'Choose a database or type its name.';
}) {
    return (
        <div className="create-table-field">
            <label htmlFor={databaseInputId}>Database</label>
            <div className="create-table-database-picker">
                <input
                    ref={databaseInput}
                    id={databaseInputId}
                    aria-label="Database"
                    aria-describedby="create-table-database-help"
                    aria-invalid={databaseTouched && !databaseIsValid}
                    aria-autocomplete="list"
                    aria-haspopup="listbox"
                    aria-expanded={databaseOptionsOpen}
                    aria-controls={databaseOptionsId}
                    aria-activedescendant={
                        databaseOptionsOpen && highlightedDatabaseOption >= 0
                            ? `${databaseOptionsId}-option-${highlightedDatabaseOption}`
                            : undefined
                    }
                    role="combobox"
                    value={database}
                    onFocus={() => {
                        setDatabaseOptionsOpen(true);
                        setDatabaseOptionsQuery('');
                        setActiveDatabaseOption(-1);
                    }}
                    onBlur={() => {
                        setDatabaseOptionsOpen(false);
                        setActiveDatabaseOption(-1);
                        setDatabaseTouched(true);
                    }}
                    onChange={event => {
                        setDatabase(event.target.value);
                        setDatabaseOptionsQuery(event.target.value);
                        setDatabaseOptionsOpen(true);
                        setActiveDatabaseOption(-1);
                    }}
                    onKeyDown={handleDatabaseKeyDown}
                    required
                    maxLength={128}
                    pattern={identifierPatternAttribute}
                    autoComplete="off"
                    className="create-table-control create-table-database-input font-mono"
                />
                <button
                    type="button"
                    className="create-table-database-trigger"
                    aria-label={
                        databaseOptionsOpen ? 'Hide database options' : 'Show database options'
                    }
                    aria-expanded={databaseOptionsOpen}
                    aria-controls={databaseOptionsId}
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => {
                        if (databaseOptionsOpen) setDatabaseOptionsOpen(false);
                        else {
                            setDatabaseOptionsQuery('');
                            setDatabaseOptionsOpen(true);
                        }
                        setActiveDatabaseOption(-1);
                        databaseInput.current?.focus();
                    }}
                >
                    <Icon name="chevron" className={databaseOptionsOpen ? 'is-open' : ''} />
                </button>
                <div
                    id={databaseOptionsId}
                    role="listbox"
                    aria-label="Databases"
                    hidden={!databaseOptionsOpen}
                    className="create-table-database-options"
                >
                    {databaseOptions.map((name, index) => (
                        <div
                            key={name}
                            id={`${databaseOptionsId}-option-${index}`}
                            role="option"
                            aria-selected={database === name}
                            onPointerDown={event => event.preventDefault()}
                            onClick={() => selectDatabase(name)}
                            className={`create-table-database-option${highlightedDatabaseOption === index ? ' is-active' : ''}${database === name ? ' is-selected' : ''}`}
                        >
                            {name}
                        </div>
                    ))}
                </div>
                {databaseOptionsOpen && databaseOptions.length === 0 && (
                    <p role="status" className="create-table-database-empty">
                        No matches. You can type another name; it must already exist.
                    </p>
                )}
            </div>
            <span
                id="create-table-database-help"
                className={`create-table-help${databaseTouched && !databaseIsValid ? ' is-error' : ''}`}
            >
                {databaseHelp}
            </span>
        </div>
    );
}
