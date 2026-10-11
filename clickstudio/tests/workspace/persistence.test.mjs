import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createWorkspaceWriter,
    STORAGE_ERROR,
} from '../../.workspace-build/src/frontend/workspace/editor/drafts/workspace-persistence.js';
import {
    newDraft,
    recover,
} from '../../.workspace-build/src/frontend/workspace/editor/drafts/workspace-state.js';

const state = sql => {
    const draft = newDraft('Work.sql', sql);
    return { version: 1, tabs: [draft], activeId: draft.id };
};
function setup(t, write) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const writes = [],
        errors = [];
    const writer = createWorkspaceWriter(
        'demo',
        write ?? ((key, value) => writes.push([key, JSON.parse(value)])),
        message => errors.push(message),
    );
    t.after(() => writer.dispose());
    return { writer, writes, errors };
}

test('Typing is debounced and only the latest state is written', t => {
    const { writer, writes } = setup(t);
    writer.schedule(state('SELECT 1'));
    t.mock.timers.tick(100);
    writer.schedule(state('SELECT 2'));
    t.mock.timers.tick(149);
    assert.equal(writes.length, 0);
    t.mock.timers.tick(1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].tabs[0].sql, 'SELECT 2');
});

test('Unmount flushes pending edits before the debounce deadline', t => {
    const { writer, writes } = setup(t);
    writer.schedule(state('SELECT unsaved'));
    assert.equal(writer.dispose(), true);
    assert.equal(writes[0][1].tabs[0].sql, 'SELECT unsaved');
    t.mock.timers.tick(1000);
    assert.equal(writes.length, 1);
});

test('Page-hide flush persists immediately and cancels the timer', t => {
    const { writer, writes } = setup(t);
    writer.schedule(state('SELECT pagehide'));
    assert.equal(writer.flush(), true);
    assert.equal(writes.length, 1);
    t.mock.timers.tick(150);
    assert.equal(writes.length, 1);
});

test('Switching connections does not write either draft under the other key', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new Map();
    const write = (key, value) => store.set(key, value);
    const first = createWorkspaceWriter('first', write, () => {});
    const second = createWorkspaceWriter('second', write, () => {});
    first.schedule(state('SELECT first'));
    first.dispose();
    second.schedule(state('SELECT second'));
    second.dispose();
    assert.equal(recover('first', { getItem: key => store.get(key) }).tabs[0].sql, 'SELECT first');
    assert.equal(
        recover('second', { getItem: key => store.get(key) }).tabs[0].sql,
        'SELECT second',
    );
    t.mock.timers.tick(1000);
    assert.equal(store.size, 2);
});

test('A failed write is reported and stays available for retry', t => {
    let fail = true;
    const writes = [];
    const { writer, errors } = setup(t, (key, value) => {
        if (fail) throw new Error('quota');
        writes.push(value);
    });
    writer.schedule(state('SELECT important'));
    assert.equal(writer.flush(), false);
    assert.equal(errors.at(-1), STORAGE_ERROR);
    fail = false;
    assert.equal(writer.flush(), true);
    assert.equal(JSON.parse(writes[0]).tabs[0].sql, 'SELECT important');
    assert.equal(errors.at(-1), '');
});

test('New edits replace an older pending failed write', t => {
    let fail = true;
    let persisted;
    const { writer } = setup(t, (_, value) => {
        if (fail) throw new Error('quota');
        persisted = value;
    });
    writer.schedule(state('SELECT old'));
    writer.flush();
    writer.schedule(state('SELECT latest'));
    fail = false;
    writer.flush();
    assert.equal(JSON.parse(persisted).tabs[0].sql, 'SELECT latest');
});

test('Duplicate snapshots are not written twice', t => {
    const { writer, writes } = setup(t);
    const draft = state('SELECT 1');
    writer.schedule(draft);
    writer.flush();
    writer.schedule(structuredClone(draft));
    writer.flush();
    assert.equal(writes.length, 1);
});

test('A disposed writer ignores later schedules and leaves no timer behind', t => {
    const { writer, writes } = setup(t);
    writer.schedule(state('SELECT initial'));
    writer.dispose();
    writer.schedule(state('SELECT ignored'));
    t.mock.timers.tick(1000);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].tabs[0].sql, 'SELECT initial');
});

test('Disposal accurately reports storage failure instead of claiming a save', t => {
    const { writer, errors } = setup(t, () => {
        throw new Error('denied');
    });
    writer.schedule(state('SELECT 1'));
    assert.equal(writer.dispose(), false);
    assert.equal(errors.at(-1), STORAGE_ERROR);
});

test('Strict-mode style setup, cleanup and setup preserves each committed snapshot', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const values = [];
    const write = (_, value) => values.push(JSON.parse(value).tabs[0].sql);
    const first = createWorkspaceWriter('same', write, () => {});
    first.schedule(state('SELECT initial'));
    first.dispose();
    const second = createWorkspaceWriter('same', write, () => {});
    second.schedule(state('SELECT edited'));
    second.dispose();
    assert.deepEqual(values, ['SELECT initial', 'SELECT edited']);
});
