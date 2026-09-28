import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudImportQueryLogOutcome } from '../../.core-build/shared/cloud-import-status.js';

test('Cloud import query logs treat a finish as success', () => {
    assert.equal(cloudImportQueryLogOutcome([{ type: 'QueryStart' }, { type: 'QueryFinish' }]), 'finished');
});

test('Cloud import query logs recognize exceptions before a start-only state', () => {
    assert.equal(cloudImportQueryLogOutcome([{ type: 'QueryStart' }, { type: 'ExceptionWhileProcessing' }]), 'exception');
});

test('A start without a terminal event is not proof that the import is running', () => {
    assert.equal(cloudImportQueryLogOutcome([{ type: 'QueryStart' }]), 'started');
});

test('Cloud import query logs report missing events distinctly', () => {
    assert.equal(cloudImportQueryLogOutcome([]), 'missing');
});
