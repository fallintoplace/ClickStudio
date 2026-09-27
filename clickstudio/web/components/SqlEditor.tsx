import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, hoverTooltip, keymap, lineNumbers, highlightActiveLine, drawSelection, rectangularSelection, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, indentSelection } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { autocompletion, ifNotIn, nextSnippetField, prevSnippetField, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { sql, SQLDialect } from '@codemirror/lang-sql';
import { setDiagnostics } from '@codemirror/lint';
import type { ApiError, Schema } from '../../shared/types';
import type { SqlErrorRange } from '../sql-error';
import { nativeDiagnosticForStatement, nativeHighlightRanges, type NativeDiagnostic, type NativeHighlightType, type NativeParseSnapshot, type NativeParseStatement, type NativeParserStatus } from '../../shared/native-parser';
import { hasSqlComments, quoteIdentifier } from '../../shared/sql';
import { activeStatementIndex, CLICKHOUSE_KEYWORDS, completionTarget, matchingNames, tableAliases as aliasesFor } from '../../shared/editor-tools';
import { appendSqlSnippet, clickhouseSnippetCompletions, sqlEditorTools, sqlStatementOutline } from './editor-tools';
import { clickHouseNativeParser } from '../clickhouse-native-parser';
import { ScrollEdgeShadows, useScrollEdges } from './ScrollEdgeShadows';
const keywordCompletions = [...new Set(CLICKHOUSE_KEYWORDS.split(' '))].map(label => ({ label, type: 'keyword' }));
const clickhouse = SQLDialect.define({ keywords: CLICKHOUSE_KEYWORDS, types: 'String UInt8 UInt16 UInt32 UInt64 UInt128 UInt256 Int8 Int16 Int32 Int64 Int128 Int256 Float32 Float64 Date Date32 DateTime DateTime64 Nullable Array Tuple Map Decimal LowCardinality UUID JSON', builtin: 'count sum avg min max uniq uniqExact quantile median toDate toDateTime toStartOfDay toStartOfHour now today numbers arrayJoin arrayMap arrayFilter multiIf ifNull coalesce', doubleQuotedStrings: false, hashComments: true });
const clickhouseFunctions = [
    ['count', 'Aggregate count of rows'], ['sum', 'Aggregate numeric values'], ['avg', 'Average numeric values'], ['uniqExact', 'Exact distinct count'],
    ['quantile', 'Approximate quantile aggregate'], ['median', 'Median aggregate'], ['toDate', 'Convert a value to Date'], ['toDateTime', 'Convert a value to DateTime'],
    ['toStartOfDay', 'Round a DateTime down to the day'], ['toStartOfHour', 'Round a DateTime down to the hour'], ['now', 'Current server DateTime'],
    ['today', 'Current server Date'], ['numbers', 'Generate a sequence of numbers'], ['arrayJoin', 'Expand an array into rows'], ['arrayMap', 'Map a lambda over an array'],
    ['arrayFilter', 'Filter an array with a lambda'], ['multiIf', 'Multi-branch conditional'], ['ifNull', 'Replace NULL with a fallback'], ['coalesce', 'Return the first non-NULL value'],
] as const;
const setNativeDecorations = StateEffect.define<DecorationSet>();
const nativeDecorations = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (value, transaction) => {
        if (transaction.docChanged)
            value = Decoration.none;
        for (const effect of transaction.effects) {
            if (effect.is(setNativeDecorations))
                value = effect.value;
        }
        return value;
    },
    provide: field => EditorView.decorations.from(field),
});
const setServerErrorDecorations = StateEffect.define<DecorationSet>();
const serverErrorDecorations = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (value, transaction) => {
        if (transaction.docChanged) value = Decoration.none;
        for (const effect of transaction.effects) {
            if (effect.is(setServerErrorDecorations)) value = effect.value;
        }
        return value;
    },
    provide: field => EditorView.decorations.from(field),
});
const setSqlMapHighlight = StateEffect.define<DecorationSet>();
const sqlMapHighlight = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (value, transaction) => {
        if (transaction.docChanged || transaction.selection !== undefined)
            value = Decoration.none;
        for (const effect of transaction.effects) {
            if (effect.is(setSqlMapHighlight))
                value = effect.value;
        }
        return value;
    },
    provide: field => EditorView.decorations.from(field),
});
const nativeDecorationClasses: Partial<Record<NativeHighlightType, string>> = {
    function: 'cm-native-function',
    alias: 'cm-native-alias',
    substitution: 'cm-native-substitution',
    string_escape: 'cm-native-string-escape',
    string_metacharacter: 'cm-native-string-metacharacter',
};

function decorationsForNativeResults(statements: readonly NativeParseStatement[]): DecorationSet {
    const ranges = statements.flatMap(statement => nativeHighlightRanges(statement.sql, statement.from, statement.result.highlights))
        .flatMap(range => nativeDecorationClasses[range.type]
            ? [{ from: range.from, to: range.to, className: nativeDecorationClasses[range.type]! }]
            : [])
        .sort((left, right) => left.from - right.from || left.to - right.to);
    return Decoration.set(ranges.map(range => Decoration.mark({ class: range.className }).range(range.from, range.to)), true);
}

const unquote = (value: string) => value.replace(/^`|`$/g, '').replace(/^"|"$/g, '');
type SchemaIndex = {
    columns: Schema['columns'];
    columnsByTable: Map<string, Schema['columns']>;
    tables: Schema['tables'];
    tablesByName: Map<string, Schema['tables'][number]>;
    codeMirror: Record<string, string[]>;
};
const tableKey = (database: string, table: string) => `${database}\u0000${table}`;
function indexSchema(schema: Schema | undefined): SchemaIndex {
    const columns = schema?.columns ?? [], columnsByTable = new Map<string, Schema['columns']>(), tablesByName = new Map<string, Schema['tables'][number]>(), codeMirror: Record<string, string[]> = {};
    for (const column of columns) {
        const key = tableKey(column.database, column.table), grouped = columnsByTable.get(key) ?? [];
        grouped.push(column);
        columnsByTable.set(key, grouped);
    }
    for (const table of schema?.tables ?? []) {
        const qualified = `${table.database}.${table.name}`.toLowerCase(), short = table.name.toLowerCase();
        tablesByName.set(qualified, table);
        if (!tablesByName.has(short))
            tablesByName.set(short, table);
        codeMirror[`${table.database}.${table.name}`] = (columnsByTable.get(tableKey(table.database, table.name)) ?? []).map(column => column.name);
    }
    return { columns, columnsByTable, tables: schema?.tables ?? [], tablesByName, codeMirror };
}
function indexedTable(index: SchemaIndex, name: string) {
    return index.tablesByName.get(name.toLowerCase());
}
function completionSource(context: CompletionContext, index: SchemaIndex): CompletionResult | null {
    const line = context.state.doc.lineAt(context.pos);
    const target = completionTarget(context.state.sliceDoc(line.from, context.pos), context.explicit);
    if (!target) return null;
    const { qualifier, prefix } = target;
    const statements = context.state.field(sqlStatementOutline).statements;
    const statement = statements[activeStatementIndex(statements, context.pos)];
    const aliases = aliasesFor(statement?.sql ?? '');
    const tableName = qualifier ? aliases.get(unquote(qualifier).toLowerCase()) ?? qualifier : undefined;
    const table = tableName ? indexedTable(index, tableName) : undefined;
    const candidates = table ? index.columnsByTable.get(tableKey(table.database, table.name)) ?? [] : qualifier ? [] : index.columns;
    const columns = matchingNames(candidates, column => column.name, prefix).map(column => ({
        label: column.name, apply: quoteIdentifier(column.name), type: 'variable', detail: `${column.type} · ${column.database}.${column.table}`,
    }));
    const tableCandidates = qualifier ? table ? [] : index.tables.filter(item => item.database.toLowerCase() === qualifier.toLowerCase()) : index.tables;
    const tables = matchingNames(tableCandidates, item => qualifier ? item.name : `${item.database}.${item.name}`, prefix).map(item => ({
        label: qualifier ? item.name : `${item.database}.${item.name}`,
        apply: qualifier ? quoteIdentifier(item.name) : `${quoteIdentifier(item.database)}.${quoteIdentifier(item.name)}`,
        type: 'class', detail: item.engine,
    }));
    const functions = qualifier ? [] : clickhouseFunctions.map(([label, detail]) => ({ label, type: 'function', detail }));
    // Prefix-capped schema options must be recomputed as the user types, not cached with validFor.
    return { from: line.from + target.from, options: [...functions, ...(qualifier ? [] : keywordCompletions), ...tables, ...columns, ...(qualifier ? [] : clickhouseSnippetCompletions)] };
}
function hoverInfo(index: SchemaIndex, sqlText: string, label: string) {
    const functionInfo = clickhouseFunctions.find(([name]) => name.toLowerCase() === label.toLowerCase());
    if (functionInfo)
        return `${functionInfo[0]}() · ${functionInfo[1]}`;
    const aliases = aliasesFor(sqlText), raw = unquote(label), qualified = raw.split('.'), columnName = qualified.at(-1)!.toLowerCase(), tableName = qualified.length > 1 ? aliases.get(qualified.slice(0, -1).join('.').toLowerCase()) ?? qualified.slice(0, -1).join('.') : undefined;
    const matchedTable = tableName ? indexedTable(index, tableName) : undefined, columns = matchedTable ? index.columnsByTable.get(tableKey(matchedTable.database, matchedTable.name)) ?? [] : index.columns;
    const column = columns.find(c => c.name.toLowerCase() === columnName);
    if (column)
        return `${column.database}.${column.table}.${column.name} · ${column.type}${column.comment ? ` · ${column.comment}` : ''}`;
    const table = indexedTable(index, raw);
    return table ? `${table.database}.${table.name} · ${table.engine}` : undefined;
}
export interface EditorHandle {
    insert: (text: string) => void;
    insertSnippet: (template: string) => boolean;
    focus: () => void;
    revealRange: (from: number, to: number) => void;
    indent: () => void;
    retryNativeParser: () => void;
    formatNative: () => Promise<'formatted' | 'fallback' | 'unavailable' | 'rejected'>;
    selection: () => {
        from: number;
        to: number;
    };
}
export interface SqlEditorProps {
    value: string;
    from: number;
    to: number;
    schema?: Schema;
    dark: boolean;
    nativeParserEnabled: boolean;
    parserStatus: NativeParserStatus;
    error?: ApiError;
    errorRange?: SqlErrorRange;
    onChange: (value: string) => void;
    onSelection: (from: number, to: number) => void;
    onRun: (script: boolean) => void;
    onNativeParserStatus?: (status: NativeParserStatus) => void;
    onNativeParseSnapshot?: (snapshot?: NativeParseSnapshot) => void;
}
export const SqlEditor = forwardRef<EditorHandle, SqlEditorProps>(function SqlEditor(props, ref) {
    const element = useRef<HTMLDivElement>(null), view = useRef<EditorView | undefined>(undefined), current = useRef(props), language = useRef(new Compartment()), theme = useRef(new Compartment());
    const { ref: setScrollViewport, edges } = useScrollEdges<HTMLElement>();
    const nativeDiagnostics = useRef<NativeDiagnostic[]>([]), validationRevision = useRef(0);
    current.current = props;
    const schemaIndex = useMemo(() => indexSchema(props.schema), [props.schema]), schemaIndexRef = useRef(schemaIndex);
    schemaIndexRef.current = schemaIndex;
    const applyDiagnostics = useCallback(() => {
        const editor = view.current;
        if (!editor)
            return;
        const diagnostics = nativeDiagnostics.current.map(item => ({ ...item, severity: 'error' as const, source: 'ClickHouse native parser' }));
        const errorRange = current.current.errorRange;
        const position = errorRange?.from ?? current.current.error?.position;
        const from = position === undefined ? undefined : Math.max(0, Math.min(position, editor.state.doc.length));
        const to = from === undefined ? undefined : Math.max(from, Math.min(errorRange?.to ?? from + 1, editor.state.doc.length));
        if (from !== undefined && to !== undefined) {
            diagnostics.push({ from, to, severity: 'error', message: current.current.error?.message ?? 'ClickHouse reported an error here.', source: 'ClickHouse server' });
            const decorations = from < editor.state.doc.length
                ? [Decoration.line({ class: 'cm-server-error-line' }).range(editor.state.doc.lineAt(from).from), ...(to > from ? [Decoration.mark({ class: 'cm-server-error-token' }).range(from, to)] : [])]
                : [];
            editor.dispatch({ effects: setServerErrorDecorations.of(Decoration.set(decorations, true)) });
        } else {
            editor.dispatch({ effects: setServerErrorDecorations.of(Decoration.none) });
        }
        editor.dispatch(setDiagnostics(editor.state, diagnostics));
    }, []);
    const languageExtension = useCallback(() => sql({ dialect: clickhouse, schema: schemaIndexRef.current.codeMirror }), []);
    const invalidateNativeValidation = useCallback(() => { validationRevision.current++; }, []);
    const themeExtension = () => EditorView.theme({ '&': { height: '100%', backgroundColor: 'var(--panel)', color: 'var(--text)' }, '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.55', fontVariantLigatures: 'none', fontVariantNumeric: 'tabular-nums' }, '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--muted)', border: 'none', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }, '.cm-content': { minHeight: '220px' }, '.cm-cursor': { borderLeftColor: 'var(--text)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--editor-selection)' } }, { dark: current.current.dark });
    useEffect(() => { if (!element.current)
        return; const p = current.current; const editor = new EditorView({ parent: element.current, state: EditorState.create({ doc: p.value, selection: { anchor: Math.min(p.from, p.value.length), head: Math.min(p.to, p.value.length) }, extensions: [sqlEditorTools(), nativeDecorations, serverErrorDecorations, sqlMapHighlight, lineNumbers(), history(), drawSelection(), highlightActiveLine(), rectangularSelection(), bracketMatching(), foldGutter(), highlightSelectionMatches(), syntaxHighlighting(defaultHighlightStyle), autocompletion({ override: [ifNotIn(['QuotedIdentifier', 'String', 'LineComment', 'BlockComment'], context => completionSource(context, schemaIndexRef.current))] }), hoverTooltip((view, pos) => { const word = view.state.wordAt(pos); if (!word)
                return null; const label = view.state.sliceDoc(word.from, word.to), info = hoverInfo(schemaIndexRef.current, current.current.value, label); if (!info)
                return null; return { pos: word.from, end: word.to, above: true, create: () => { const dom = document.createElement('div'); dom.className = 'sql-hover'; dom.textContent = info; return { dom }; } }; }), language.current.of(languageExtension()), theme.current.of(themeExtension()), EditorState.allowMultipleSelections.of(true), EditorView.contentAttributes.of({ 'aria-label': 'SQL editor', 'spellcheck': 'false' }), keymap.of([{ key: 'Tab', run: nextSnippetField, shift: prevSnippetField }, { key: 'Mod-Enter', run: () => { current.current.onRun(false); return true; } }, { key: 'Mod-Shift-Enter', run: () => { current.current.onRun(true); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]), EditorView.updateListener.of(update => { if (update.docChanged)
                    current.current.onChange(update.state.doc.toString()); if (update.selectionSet) {
                    const s = update.state.selection.main;
                    current.current.onSelection(s.from, s.to);
                } })] }) }); view.current = editor; setScrollViewport(editor.scrollDOM); return () => { setScrollViewport(null); editor.destroy(); view.current = undefined; }; }, [languageExtension, setScrollViewport]);
    useEffect(() => { const v = view.current; if (v && v.state.doc.toString() !== props.value) {
        const { from, to } = current.current;
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value }, selection: { anchor: Math.min(from, props.value.length), head: Math.min(to, props.value.length) } });
    } }, [props.value]);
    useEffect(() => {
        if (!props.nativeParserEnabled)
            return;
        return clickHouseNativeParser.subscribe(status => current.current.onNativeParserStatus?.(status));
    }, [props.nativeParserEnabled]);
    useEffect(() => {
        const editor = view.current, revision = ++validationRevision.current;
        nativeDiagnostics.current = [];
        applyDiagnostics();
        editor?.dispatch({ effects: setNativeDecorations.of(Decoration.none) });
        current.current.onNativeParseSnapshot?.(undefined);
        if (!editor || !props.nativeParserEnabled || props.parserStatus !== 'ready')
            return;
        const source = editor.state.doc.toString();
        const outline = editor.state.field(sqlStatementOutline);
        if (outline.error || !outline.statements.length)
            return;
        const statements = outline.statements.map(statement => ({ from: statement.from, to: statement.to, sql: statement.sql }));
        const timer = window.setTimeout(() => {
            const startedAt = performance.now();
            void clickHouseNativeParser.parseMany(statements.map(statement => statement.sql)).then(results => {
                if (revision !== validationRevision.current || editor.state.doc.toString() !== source)
                    return;
                const parsedStatements: NativeParseStatement[] = statements.map((statement, index) => ({
                    ...statement,
                    result: results[index] ?? {},
                }));
                const snapshot: NativeParseSnapshot = {
                    statements: parsedStatements,
                    elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
                };
                nativeDiagnostics.current = results.flatMap((result, index) => {
                    const error = result.error, statement = statements[index];
                    return error && statement ? [nativeDiagnosticForStatement(statement.sql, statement.from, error)] : [];
                });
                editor.dispatch({ effects: setNativeDecorations.of(decorationsForNativeResults(parsedStatements)) });
                current.current.onNativeParseSnapshot?.(snapshot);
                applyDiagnostics();
            }).catch(() => {
                if (revision !== validationRevision.current || editor.state.doc.toString() !== source)
                    return;
                nativeDiagnostics.current = [];
                editor.dispatch({ effects: setNativeDecorations.of(Decoration.none) });
                current.current.onNativeParseSnapshot?.(undefined);
                applyDiagnostics();
            });
        }, 250);
        return () => {
            invalidateNativeValidation();
            window.clearTimeout(timer);
        };
    }, [props.nativeParserEnabled, props.parserStatus, props.value, applyDiagnostics, invalidateNativeValidation]);
    useEffect(() => { const v = view.current; if (!v)
        return; const from = Math.min(props.from, v.state.doc.length), to = Math.min(props.to, v.state.doc.length); if (v.state.selection.main.from !== from || v.state.selection.main.to !== to)
        v.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true }); }, [props.from, props.to]);
    useEffect(() => { view.current?.dispatch({ effects: language.current.reconfigure(languageExtension()) }); }, [schemaIndex, languageExtension]);
    useEffect(() => { view.current?.dispatch({ effects: theme.current.reconfigure(themeExtension()) }); }, [props.dark]);
    useEffect(() => applyDiagnostics(), [props.error, props.errorRange, applyDiagnostics]);
    useImperativeHandle(ref, () => ({
        insert: text => { const v = view.current; if (v) {
            v.dispatch(v.state.replaceSelection(text));
            v.focus();
        } },
        insertSnippet: template => { const editor = view.current; return editor ? appendSqlSnippet(editor, template) : false; },
        focus: () => view.current?.focus(),
        revealRange: (from, to) => {
            const editor = view.current;
            if (!editor) return;
            const start = Math.max(0, Math.min(from, editor.state.doc.length));
            const end = Math.max(start, Math.min(to, editor.state.doc.length));
            const highlight = end > start
                ? Decoration.set([Decoration.mark({ class: 'cm-sql-map-highlight' }).range(start, end)])
                : Decoration.none;
            editor.dispatch({ effects: [setSqlMapHighlight.of(highlight), EditorView.scrollIntoView(start, { y: 'center' })] });
        },
        indent: () => { if (view.current)
            indentSelection(view.current); },
        retryNativeParser: () => clickHouseNativeParser.retry(),
        formatNative: async () => {
            const editor = view.current;
            if (!editor)
                return 'rejected';
            const outline = editor.state.field(sqlStatementOutline);
            if (outline.error || !outline.statements.length)
                return 'rejected';
            const before = editor.state.doc.toString(), statements = outline.statements;
            if (statements.some(statement => hasSqlComments(statement.sql)))
                return 'fallback';
            try {
                const results = await clickHouseNativeParser.formatMany(statements.map(statement => statement.sql));
                if (view.current !== editor || editor.state.doc.toString() !== before)
                    return 'rejected';
                const invalid: NativeDiagnostic[] = [];
                results.forEach((result, index) => {
                    const error = result.error, statement = statements[index];
                    if (error && statement)
                        invalid.push(nativeDiagnosticForStatement(statement.sql, statement.from, error));
                });
                if (invalid.length) {
                    nativeDiagnostics.current = invalid;
                    applyDiagnostics();
                    return 'rejected';
                }
                const changes = statements.flatMap((statement, index) => {
                    const formatted = results[index]?.sql;
                    return formatted !== undefined && formatted !== statement.sql ? [{ from: statement.from, to: statement.to, insert: formatted }] : [];
                });
                if (changes.length)
                    editor.dispatch({ changes });
                editor.focus();
                return 'formatted';
            } catch {
                return 'unavailable';
            }
        },
        selection: () => { const s = view.current?.state.selection.main; return { from: s?.from ?? 0, to: s?.to ?? 0 }; },
    }), [applyDiagnostics]);
    return <div className="sql-editor" ref={element}><ScrollEdgeShadows edges={edges}/></div>;
});
