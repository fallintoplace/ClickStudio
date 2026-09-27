import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseInput, ImportService } from '../../.core-build/core/imports.js';
import { AssistantService, buildContext } from '../../.core-build/core/assistant.js';
import { evaluateProposal, runAssistantBenchmarks } from '../../.core-build/core/assistant-evaluation.js';
import { selectAssistantReferenceDocs } from '../../.core-build/shared/reference-data.js';
import { ONTIME_FLIGHT_DELAY_EXAMPLE, selectAssistantExamples } from '../../.core-build/shared/assistant-examples.js';
import { MemoryStore } from '../../.core-build/core/store.js';
import { exportCsv, chartNumber, filterRows, sampleChartRows, MAX_CHART_RENDER_POINTS } from '../../.core-build/shared/results.js';
import { owner, other, schema } from './helpers.mjs';
const proposal = { sql: 'SELECT 1', summary: 'A proposal', assumptions: [], tables: [], caveats: [], clarification: null, findings: [] };
function aiFixture(content = proposal) { const store = new MemoryStore(); let calls = 0; const driver = { available: true, model: 'fixture', async propose() { calls++; return { content, responseId: 'fixture-response' }; } }; const ai = new AssistantService(store, driver, () => true); return { store, ai, get calls() { return calls; }, input: { connectionId: 'local', sql: 'SELECT 2', action: 'generate', question: 'Count events', schema } }; }
test('CSV handles BOM, quoted commas, CRLF and multiline cells', () => { const p = parseCsv('\ufeffn,label\r\n1,"a,b"\r\n2,"two\nlines"\r\n'); assert.equal(p.rows[0].label, 'a,b'); assert.equal(p.rows[1].label, 'two\nlines'); });
test('CSV handles escaped quotes', () => assert.equal(parseCsv('n\n"say ""hi"""').rows[0].n, 'say "hi"'));
for (const csv of ['a,a\n1,2', 'a,b\n1', 'a\n"oops', 'a\n"quoted"tail'])
    test(`CSV invalid input ${csv}`, () => assert.throws(() => parseCsv(csv)));
test('JSON nested values retain structure and large integer strings', () => { const p = parseInput('[{"id":"18446744073709551615","v":[1,null]}]', 'json'); assert.equal(p.rows[0].id, '18446744073709551615'); assert.deepEqual(p.rows[0].v, [1, null]); });
test('JSON unsafe numeric imports reject', () => assert.throws(() => parseInput('[{"id":18446744073709551615}]', 'json'), { code: 'UNSAFE_NUMBER' }));
test('Import preview has no write side effect; commit is idempotent', async () => { let inserts = 0; const driver = { schema: async () => schema, allowed: () => true, insert: async () => { inserts++; } }; const imports = new ImportService(new MemoryStore(), driver, () => true); const input = imports.preview(owner, 'a.csv', 'n\n1\n2', 'csv'); assert.equal(inserts, 0); const map = await imports.map(owner, input.id, 'local', 'default.events', { n: 'n' }); assert.equal(inserts, 0); assert.throws(() => imports.get(other, input.id), { code: 'NOT_FOUND' }); const [a, b] = await Promise.all([imports.commit(owner, map.id, 'INSERT 2 ROWS'), imports.commit(owner, map.id, 'INSERT 2 ROWS')]); assert.equal(a.id, b.id); assert.equal(inserts, 1); });
test('Concurrent imports to the same table recheck the write guard after schema loading', async () => {
    let schemaCalls = 0, inserts = 0, releaseSchema;
    let pauseSchema = false;
    const schemaGate = new Promise(resolve => { releaseSchema = resolve; });
    const driver = {
        schema: async () => {
            if (pauseSchema) {
                schemaCalls++;
                if (schemaCalls === 2) releaseSchema();
                await schemaGate;
            }
            return schema;
        },
        allowed: () => true,
        insert: async () => { inserts++; },
    };
    const imports = new ImportService(new MemoryStore(), driver, () => true);
    const first = imports.preview(owner, 'first.csv', 'n\n1', 'csv');
    const second = imports.preview(owner, 'second.csv', 'n\n2', 'csv');
    const firstMapping = await imports.map(owner, first.id, 'local', 'default.events', { n: 'n' });
    const secondMapping = await imports.map(owner, second.id, 'local', 'default.events', { n: 'n' });
    pauseSchema = true;

    const results = await Promise.allSettled([
        imports.commit(owner, firstMapping.id, 'INSERT 1 ROWS'),
        imports.commit(owner, secondMapping.id, 'INSERT 1 ROWS'),
    ]);

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.equal(rejected.reason.code, 'IMPORT_UNRESOLVED');
    assert.equal(inserts, 1);
});
test('Failed inserts are unknown, never auto-retried', async () => { let inserts = 0; const driver = { schema: async () => schema, allowed: () => true, insert: async () => { inserts++; throw new Error('connection lost'); } }; const imports = new ImportService(new MemoryStore(), driver, () => true); const input = imports.preview(owner, 'a.csv', 'n\n1', 'csv'), map = await imports.map(owner, input.id, 'local', 'default.events', { n: 'n' }); assert.equal((await imports.commit(owner, map.id, 'INSERT 1 ROWS')).status, 'unknown'); await imports.commit(owner, map.id, 'INSERT 1 ROWS'); assert.equal(inserts, 1); });
test('Recoverable imports stay owner-scoped and block another write until reviewed', async () => {
    let inserts = 0, failFirst = true, evidence = 'running';
    const driver = { schema: async () => schema, allowed: () => true, insert: async () => { inserts++; if (failFirst) { failFirst = false; throw new Error('connection lost'); } }, inspectInsert: async () => evidence };
    const imports = new ImportService(new MemoryStore(), driver, () => true);
    const first = imports.preview(owner, 'first.csv', 'n\n1', 'csv');
    const firstMapping = await imports.map(owner, first.id, 'local', 'default.events', { n: 'n' });
    const unknown = await imports.commit(owner, firstMapping.id, 'INSERT 1 ROWS');
    const second = imports.preview(owner, 'second.csv', 'n\n2', 'csv');
    const secondMapping = await imports.map(owner, second.id, 'local', 'default.events', { n: 'n' });
    assert.deepEqual(imports.listRecoverable(owner, 'local').map(job => job.id), [unknown.id]);
    assert.deepEqual(imports.listRecoverable(other), []);
    await assert.rejects(imports.commit(owner, secondMapping.id, 'INSERT 1 ROWS'), { code: 'IMPORT_UNRESOLVED' });
    assert.equal(inserts, 1);
    const active = await imports.review(owner, unknown.id, true, true);
    assert.equal(active.status, 'running');
    assert.equal(active.reviewedAt, undefined);
    assert.deepEqual(imports.listRecoverable(owner, 'local').map(job => job.id), [unknown.id]);
    await assert.rejects(imports.commit(owner, secondMapping.id, 'INSERT 1 ROWS'), { code: 'IMPORT_UNRESOLVED' });
    evidence = 'unknown';
    assert.equal((await imports.reconcile(owner, unknown.id)).status, 'unknown');
    const reviewed = await imports.review(owner, unknown.id, true, true);
    assert.equal(reviewed.status, 'unknown');
    assert.ok(reviewed.reviewedAt);
    assert.deepEqual(imports.listRecoverable(owner, 'local'), []);
    assert.equal((await imports.commit(owner, secondMapping.id, 'INSERT 1 ROWS')).status, 'succeeded');
    assert.equal(inserts, 2);
});
test('An import interrupted by server restart becomes recoverable and requires reconciliation', () => {
    const store = new MemoryStore();
    store.put('imports', 'interrupted', { id: 'interrupted', owner: owner.id, inputId: 'input', connectionId: 'local', table: 'default.events', queryId: 'query-interrupted', rows: 1, createdAt: new Date().toISOString(), status: 'running' });

    const imports = new ImportService(store, {}, () => true);
    const [recovered] = imports.listRecoverable(owner);

    assert.equal(recovered.status, 'unknown');
    assert.equal(recovered.reconciliationRequired, true);
    assert.match(recovered.error, /Application restarted/);
});
test('Import reconciliation only marks a confirmed successful ClickHouse finish as succeeded', async () => {
    let evidence = 'running', inserts = 0;
    const driver = { schema: async () => schema, allowed: () => true, insert: async () => { inserts++; throw new Error('response lost'); }, inspectInsert: async () => evidence };
    const imports = new ImportService(new MemoryStore(), driver, () => true);
    const input = imports.preview(owner, 'a.csv', 'n\n1', 'csv'), mapping = await imports.map(owner, input.id, 'local', 'default.events', { n: 'n' });
    const job = await imports.commit(owner, mapping.id, 'INSERT 1 ROWS');
    assert.equal(job.status, 'unknown');
    const active = await imports.reconcile(owner, job.id);
    assert.equal(active.status, 'running');
    assert.equal(active.reconciliationRequired, true);
    evidence = 'unknown';
    const inconclusive = await imports.reconcile(owner, job.id);
    assert.equal(inconclusive.status, 'unknown');
    assert.equal(inconclusive.reviewedAt, undefined);
    evidence = 'succeeded';
    const confirmed = await imports.reconcile(owner, job.id);
    assert.equal(confirmed.status, 'succeeded');
    assert.equal(confirmed.error, undefined);
    assert.deepEqual(imports.listRecoverable(owner), []);
    assert.equal(inserts, 1);
});
test('Insert requires exact confirmation', async () => { const imports = new ImportService(new MemoryStore(), { schema: async () => schema, allowed: () => true, insert: async () => { } }, () => true); const p = imports.preview(owner, 'a', 'n\n1', 'csv'), m = await imports.map(owner, p.id, 'local', 'default.events', { n: 'n' }); await assert.rejects(imports.commit(owner, m.id, 'yes'), { code: 'IMPORT_CONFIRMATION' }); });
test('Preview refuses empty CSV rather than a zero-row mutation', () => { const imports = new ImportService(new MemoryStore(), {}, () => true); assert.throws(() => imports.preview(owner, 'a.csv', 'n\n', 'csv'), { code: 'IMPORT_EMPTY' }); });
test('AI context preview does not call a model', () => { const f = aiFixture(); f.ai.prepare(owner, f.input); assert.equal(f.calls, 0); });
test('AI requires consent to the exact prepared context', async () => { const f = aiFixture(), c = f.ai.prepare(owner, f.input); await assert.rejects(f.ai.propose(owner, c.id, false), { code: 'AI_CONSENT_REQUIRED' }); assert.equal(f.calls, 0); });
test('Cancelling before model dispatch leaves context cancelled without a model call', async () => {
    const f = aiFixture(), c = f.ai.prepare(owner, f.input), controller = new AbortController();
    controller.abort();

    await assert.rejects(f.ai.propose(owner, c.id, true, controller.signal), { name: 'AbortError' });

    assert.equal(f.calls, 0);
    assert.equal(f.store.get('ai-contexts', c.id).state, 'cancelled');
    assert.equal(f.store.count('proposals'), 0);
    assert.ok(f.store.list('audit').some(event => event.action === 'ai.cancel-context' && event.resourceId === c.id));
});
test('Cancelling an in-flight model request aborts it and records the cancelled context', async () => {
    const store = new MemoryStore();
    let calls = 0, receivedSignal;
    const driver = {
        available: true,
        model: 'fixture',
        propose(_context, signal) {
            calls++;
            receivedSignal = signal;
            return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        },
    };
    const ai = new AssistantService(store, driver, () => true), c = ai.prepare(owner, { connectionId: 'local', sql: 'SELECT 2', action: 'generate', question: 'Count events', schema });
    const controller = new AbortController(), pending = ai.propose(owner, c.id, true, controller.signal);
    controller.abort();

    await assert.rejects(pending, { name: 'AbortError' });

    assert.equal(calls, 1);
    assert.equal(receivedSignal.aborted, true);
    assert.equal(store.get('ai-contexts', c.id).state, 'cancelled');
    assert.equal(store.count('proposals'), 0);
});
test('A late model response after cancellation cannot create a proposal', async () => {
    const store = new MemoryStore();
    let resolveModel;
    const modelResponse = new Promise(resolve => { resolveModel = resolve; });
    const driver = { available: true, model: 'fixture', propose: async () => modelResponse };
    const ai = new AssistantService(store, driver, () => true), c = ai.prepare(owner, { connectionId: 'local', sql: 'SELECT 2', action: 'generate', question: 'Count events', schema });
    const controller = new AbortController(), pending = ai.propose(owner, c.id, true, controller.signal);
    controller.abort();
    resolveModel({ content: proposal, responseId: 'late-response' });

    await assert.rejects(pending, { name: 'AbortError' });

    assert.equal(store.get('ai-contexts', c.id).state, 'cancelled');
    assert.equal(store.count('proposals'), 0);
});
test('Sending twice returns the same proposal and makes one model request', async () => { const f = aiFixture(), c = f.ai.prepare(owner, f.input); const a = await f.ai.propose(owner, c.id, true), b = await f.ai.propose(owner, c.id, true); assert.equal(a.id, b.id); assert.equal(f.calls, 1); });
test('Review lane cannot return applicable SQL even if model proposes it', async () => { const f = aiFixture(), c = f.ai.prepare(owner, { ...f.input, action: 'review' }), p = await f.ai.propose(owner, c.id, true); assert.equal(p.sql, null); assert.throws(() => f.ai.decide(owner, p.id, 'accepted', 'local', 'SELECT 2'), { code: 'REVIEW_ONLY' }); });
test('Proposal cannot be applied to changed SQL or another connection', async () => { const f = aiFixture(), c = f.ai.prepare(owner, f.input), p = await f.ai.propose(owner, c.id, true); assert.throws(() => f.ai.decide(owner, p.id, 'accepted', 'second', 'SELECT 2'), { code: 'CONNECTION_MISMATCH' }); assert.throws(() => f.ai.decide(owner, p.id, 'accepted', 'local', 'SELECT 3'), { code: 'DRAFT_CHANGED' }); });
test('Accepting proposal records a decision, never creates a run', async () => { const f = aiFixture(), c = f.ai.prepare(owner, f.input), p = await f.ai.propose(owner, c.id, true); f.ai.decide(owner, p.id, 'accepted', 'local', 'SELECT 2'); assert.equal(f.store.list('runs').length, 0); });
test('Unsafe generated SQL fails the quality gate and cannot be accepted', async () => { const f = aiFixture({ ...proposal, sql: 'DROP TABLE default.events' }), c = f.ai.prepare(owner, f.input), p = await f.ai.propose(owner, c.id, true); assert.equal(p.quality.status, 'fail'); assert.throws(() => f.ai.decide(owner, p.id, 'accepted', 'local', 'SELECT 2'), { code: 'AI_PROPOSAL_UNSAFE' }); });
test('AssistantService grounds generated SQL against the prepared schema', async () => { const f = aiFixture({ ...proposal, sql: 'SELECT * FROM default.events' }), c = f.ai.prepare(owner, f.input), p = await f.ai.propose(owner, c.id, true); assert.equal(p.quality.checks.find(check => check.id === 'grounding').status, 'pass'); });
test('Evaluation report counts accepted and rejected proposals without exposing SQL', async () => { const f = aiFixture(), first = f.ai.prepare(owner, f.input), firstProposal = await f.ai.propose(owner, first.id, true); f.ai.decide(owner, firstProposal.id, 'accepted', 'local', 'SELECT 2'); const second = f.ai.prepare(owner, f.input), secondProposal = await f.ai.propose(owner, second.id, true); f.ai.decide(owner, secondProposal.id, 'rejected', 'local', 'SELECT 2'); const report = f.ai.evaluation(owner); assert.equal(report.total, 2); assert.equal(report.accepted, 1); assert.equal(report.rejected, 1); assert.equal(report.acceptanceRate, 50); assert.equal(report.latest[0].score, 100); assert.equal(Object.hasOwn(report.latest[0], 'sql'), false); });
test('Static semantic checks warn on schema references that need execution evidence', () => { const quality = evaluateProposal({ ...proposal, sql: 'SELECT * FROM missing_table' }, 'generate', { schema: { truncated: false, tables: [{ database: 'default', name: 'events' }] } }); assert.equal(quality.status, 'warn'); assert.equal(quality.checks.find(check => check.id === 'grounding').status, 'warn'); });
test('Assistant benchmark suite stays green and deterministic', () => { const report = runAssistantBenchmarks(); assert.equal(report.total, 5); assert.equal(report.passed, 5); assert.equal(report.score, 100); });
test('Context masks configured sensitive columns and result fields', () => { const result = { columns: [{ name: 'secret', type: 'String' }, { name: 'n', type: 'UInt64' }], rows: [['sensitive', '1']], completeness: 'complete', createdAt: 'now', queryId: 'q' }; const ctx = buildContext({ connectionId: 'local', sql: 'SELECT n', action: 'result', question: 'Explain', schema, result, sensitiveColumns: ['secret'] }); assert.ok(!ctx.payload.context.includes('sensitive')); assert.ok(ctx.payload.context.includes('"1"')); });
test('Assistant reference retrieval selects docs for SQL functions and named tables', () => {
    const docs = selectAssistantReferenceDocs('Explain quantileExact', 'SELECT quantileExact(0.5)(latency) FROM system.query_log', { schema, limit: 20 });
    assert.ok(docs.length <= 4);
    assert.ok(docs.some(entry => entry.name === 'quantileExact'));
    assert.ok(docs.some(entry => entry.name === 'query_log' && entry.type === 'System Table'));
    assert.ok(!docs.some(entry => entry.name === 'query_log' && entry.type === 'Server Setting'));
    assert.equal(new Set(docs.map(entry => `${entry.type}:${entry.name}`)).size, docs.length);
});
test('Assistant reference retrieval considers SQL from the selected run', () => {
    const runDocs = selectAssistantReferenceDocs('Explain the exact percentile in this result', 'SELECT 1', {
        evidenceSql: 'SELECT quantileExact(0.5)(latency_ms) FROM events', schema,
    });
    assert.ok(runDocs.some(entry => entry.name === 'quantileExact'));
    assert.ok(!runDocs.some(entry => entry.type === 'Setting'));
});
test('Assistant gives general numeric overflow guidance with retained results', () => {
    const sql = 'SELECT amount * quantity AS total FROM orders';
    const question = 'Why is this result unexpectedly small?';
    const documentation = selectAssistantReferenceDocs(question, sql);
    const ctx = buildContext({
        connectionId: 'playground', action: 'ask', question, sql, schema,
        result: { queryId: 'q', createdAt: 'now', expiresAt: 'later', completeness: 'complete', columns: [{ name: 'product', type: 'Float64' }], rows: [['0']] },
        documentation,
    });
    const context = JSON.parse(ctx.payload.context);
    assert.equal(context.result.rows[0][0], '0');
    assert.match(ctx.payload.instructions, /intermediate or accumulator, and result types/);
    assert.match(ctx.payload.instructions, /overflow or truncation/);
    assert.match(ctx.payload.instructions, /casts that need to affect an operation belong before it/);
});
test('Assistant reference retrieval ignores SQL literals and comments', () => {
    const docs = selectAssistantReferenceDocs('', "SELECT 'quantileExact' AS note -- sum(1)\n/* uniqExact(id) */");
    assert.deepEqual(docs, []);
});
test('Assistant reference retrieval ranks topic docs and avoids confusing user tables with system tables', () => {
    const docs = selectAssistantReferenceDocs('Why does this query ignore the data skipping indexes?', 'SELECT value FROM events WHERE value = 42', { schema });
    assert.ok(docs.some(entry => /index/i.test(`${entry.name} ${entry.description.slice(0, 300)}`)));
    assert.ok(docs.some(entry => entry.name === 'data_skipping_index_types'));
    assert.ok(!docs.some(entry => entry.name === 'events' && entry.type === 'System Table'));
});
test('Assistant context includes bounded documentation and shows its source in the preview', () => {
    const documentation = Array.from({ length: 5 }, (_, index) => ({ name: `doc-${index}`, type: 'Function', description: 'x'.repeat(2500), serverVersion: 'offline-abc123', origin: 'bundled' }));
    const ctx = buildContext({ connectionId: 'local', sql: 'SELECT 1', action: 'explain', question: 'Explain', schema, documentation });
    const context = JSON.parse(ctx.payload.context);
    assert.equal(context.referenceDocs.length, 4);
    assert.equal(context.referenceDocs[0].description.length, 1800);
    assert.ok(ctx.summary.some(item => item.includes('ClickHouse docs sent: Function doc-0')));
    assert.ok(ctx.summary.some(item => item.includes('bounded to 4 of 5')));
    assert.match(ctx.payload.instructions, /reference documentation/);
});
test('Assistant selects the flight sample only for a matching Playground ask or generation request', () => {
    const selected = selectAssistantExamples({ connectionId: 'playground', action: 'ask', question: 'Show flights by airport', sql: 'SELECT 1' });
    assert.deepEqual(selected.map(example => example.id), [ONTIME_FLIGHT_DELAY_EXAMPLE.id]);
    assert.deepEqual(selected[0].tables, [{ database: 'ontime', table: 'ontime' }]);
    assert.equal(selectAssistantExamples({ connectionId: 'playground', action: 'generate', question: 'airline delays', sql: '' }).length, 1);
    assert.deepEqual(selectAssistantExamples({ connectionId: 'playground', action: 'ask', question: 'Summarize customer reviews', sql: 'SELECT 1' }), []);
    assert.deepEqual(selectAssistantExamples({ connectionId: 'local', action: 'ask', question: 'Show flights by airport', sql: 'SELECT 1' }), []);
    assert.deepEqual(selectAssistantExamples({ connectionId: 'playground', action: 'review', question: 'Show flights by airport', sql: 'SELECT 1' }), []);
});
test('Assistant selects a flight sample from the current SQL when the question is generic', () => {
    const selected = selectAssistantExamples({ connectionId: 'playground', action: 'ask', question: 'Explain this query', sql: 'SELECT Year FROM ontime.ontime' });
    assert.deepEqual(selected.map(example => example.id), [ONTIME_FLIGHT_DELAY_EXAMPLE.id]);
});
test('Assistant selects the flight sample from selected-run SQL and delay wording', () => {
    const fromRun = selectAssistantExamples({
        connectionId: 'playground', action: 'ask', question: 'Why did this fail?', sql: 'SELECT 1',
        evidenceSql: 'SELECT DepDelay FROM ontime.ontime',
    });
    const fromQuestion = selectAssistantExamples({
        connectionId: 'playground', action: 'ask', question: 'How did departure delays change by month?', sql: 'SELECT 1',
    });
    assert.deepEqual(fromRun.map(example => example.id), [ONTIME_FLIGHT_DELAY_EXAMPLE.id]);
    assert.deepEqual(fromQuestion.map(example => example.id), [ONTIME_FLIGHT_DELAY_EXAMPLE.id]);
});
test('Assistant keeps curated flight examples separate from live schema and prioritizes their available columns', () => {
    const column = (database, table, name) => ({ database, table, name, type: 'String', defaultKind: '', comment: '' });
    const flightSchema = {
        ...schema,
        connectionId: 'playground',
        tables: [...schema.tables, { database: 'ontime', name: 'ontime', engine: 'MergeTree' }],
        columns: [column('github', 'events', 'event_id'), column('ontime', 'ontime', 'Origin'), column('ontime', 'ontime', 'Dest'), column('ontime', 'ontime', 'FlightDate')],
    };
    const ctx = buildContext({ connectionId: 'playground', database: 'github', sql: 'SELECT 1', action: 'ask', question: 'Find flights by origin and destination', schema: flightSchema });
    const context = JSON.parse(ctx.payload.context);
    assert.deepEqual(context.curatedExamples.map(example => example.id), [ONTIME_FLIGHT_DELAY_EXAMPLE.id]);
    assert.deepEqual(context.curatedExamples[0].sourceTables, [{ database: 'ontime', table: 'ontime' }]);
    assert.deepEqual(context.schema.map(({ database, table, name }) => `${database}.${table}.${name}`), [
        'ontime.ontime.Origin', 'ontime.ontime.Dest', 'ontime.ontime.FlightDate', 'github.events.event_id',
    ]);
    assert.ok(ctx.summary.some(item => item.includes('columns from example table ontime.ontime when present')));
    assert.deepEqual(flightSchema.tables.map(table => `${table.database}.${table.name}`), ['default.events', 'ontime.ontime']);
    assert.match(ctx.payload.instructions, /separate from the live schema/);
    assert.match(ctx.payload.instructions, /schemaIncomplete is true/);

    const sampleOnly = buildContext({
        connectionId: 'playground', database: 'github', sql: 'SELECT 1', action: 'ask', question: 'Show flights',
        schema: { ...schema, connectionId: 'playground' },
    });
    const sampleOnlyContext = JSON.parse(sampleOnly.payload.context);
    assert.equal(sampleOnlyContext.curatedExamples.length, 1);
    assert.equal(sampleOnlyContext.schema.some(column => column.database === 'ontime'), false);
});
test('Assistant prioritizes matching example columns ahead of the active database column cap', () => {
    const githubColumns = Array.from({ length: 250 }, (_, index) => ({
        database: 'github', table: 'events', name: 'field_' + index, type: 'String', defaultKind: '', comment: '',
    }));
    const flightColumns = ['Origin', 'Dest', 'FlightDate'].map(name => ({
        database: 'ontime', table: 'ontime', name, type: 'String', defaultKind: '', comment: '',
    }));
    const wideSchema = { ...schema, connectionId: 'playground', columns: [...githubColumns, ...flightColumns] };
    const ctx = buildContext({ connectionId: 'playground', database: 'github', sql: 'SELECT 1', action: 'ask', question: 'Show flights', schema: wideSchema });
    const context = JSON.parse(ctx.payload.context);
    assert.equal(context.schema.length, 250);
    assert.deepEqual(context.schema.slice(0, 3).map(column => column.name), ['Origin', 'Dest', 'FlightDate']);
    assert.equal(context.schemaIncomplete, true);
});
test('Assistant still filters sensitive columns from a prioritized example table', () => {
    const flightSchema = {
        ...schema,
        connectionId: 'playground',
        columns: [
            { database: 'ontime', table: 'ontime', name: 'Origin', type: 'String', defaultKind: '', comment: '' },
            { database: 'ontime', table: 'ontime', name: 'api_key', type: 'String', defaultKind: '', comment: '' },
        ],
    };
    const ctx = buildContext({ connectionId: 'playground', database: 'github', sql: 'SELECT 1', action: 'ask', question: 'Show flights', schema: flightSchema, sensitiveColumns: ['api_key'] });
    const context = JSON.parse(ctx.payload.context);
    assert.deepEqual(context.schema.map(column => column.name), ['Origin']);
    assert.ok(!ctx.payload.context.includes('api_key'));
});
test('Assistant drops optional example context before exceeding the context byte limit', () => {
    const ctx = buildContext({
        connectionId: 'playground', database: 'github', action: 'ask', question: 'Show flights',
        sql: 'SELECT ' + 'x'.repeat(59_500), schema,
    });
    const context = JSON.parse(ctx.payload.context);
    assert.ok(Buffer.byteLength(ctx.payload.context) <= 60_000);
    assert.equal(context.curatedExamples.length, 0);
});
test('Credential-like literals in SQL are refused for AI sharing', () => assert.throws(() => buildContext({ connectionId: 'local', sql: "SELECT 'hello' -- password='dont-share'", action: 'generate', question: 'Explain', schema }), { code: 'CREDENTIAL_LIKE_CONTEXT' }));
test('CSV exports protect formula-like cells and escape quotes', () => { const csv = exportCsv({ columns: [{ name: 'x', type: 'String' }], rows: [['=1+1'], ['a"b']] }); assert.ok(csv.includes("'=1+1")); assert.ok(csv.includes('"a""b"')); });
test('CSV keeps numeric negatives numeric while protecting formula-like text', () => { const csv = exportCsv({ columns: [{ name: 'n', type: 'Int64' }, { name: 'label', type: 'String' }], rows: [['-42', '-42']] }); assert.ok(csv.includes("-42,'-42")); });
test('Charts reject unsafe integer coordinates, tables remain lossless', () => { assert.equal(chartNumber('18446744073709551615'), null); assert.equal(chartNumber('1.25'), 1.25); });
test('Chart sampling stays bounded and includes the first and last retained rows', () => {
    const rows = Array.from({ length: 350 }, (_, index) => [`row-${index}`, index === 349 ? 1000000 : index]);
    const sampled = sampleChartRows(rows, MAX_CHART_RENDER_POINTS);
    assert.equal(sampled.length, MAX_CHART_RENDER_POINTS);
    assert.deepEqual(sampled[0], rows[0]);
    assert.deepEqual(sampled.at(-1), rows.at(-1));
    assert.equal(sampled.at(-1)?.[1], 1000000);
    assert.equal(sampleChartRows(rows.slice(0, 3), MAX_CHART_RENDER_POINTS).length, 3);
    assert.deepEqual(sampleChartRows(rows, 0), []);
    assert.deepEqual(sampleChartRows(rows, 1), [rows[0]]);
});
test('Local filters operate only on retained rows', () => assert.equal(filterRows([['alpha'], ['beta']], 'ALP').length, 1));
