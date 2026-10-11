import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatCompressionRatio,
    mergeTreePartsQuery,
    parseMergeTreeParts,
    scalePartMetrics,
} from '../../.core-build/src/shared/database/explorer/storage/parts.js';

const part = (overrides = {}) => ({
    is_active: '1',
    partition: '202609',
    name: '202609_1_1_0',
    rows: '9000',
    marks: '2',
    compressed_bytes: '1000',
    uncompressed_bytes: '4000',
    level: '0',
    min_block_number: '1',
    max_block_number: '1',
    disk_name: 'default',
    modified_at: '2026-09-24 08:00:00',
    total_parts: '1',
    active_parts: '1',
    inactive_parts: '0',
    ...overrides,
});

test('Parts parser keeps UInt64 counters exact and computes exact totals', () => {
    const largest = '18446744073709551615';
    const snapshot = parseMergeTreeParts('analytics', 'events', [
        part({
            rows: largest,
            compressed_bytes: largest,
            uncompressed_bytes: largest,
            total_parts: '2',
            active_parts: '2',
        }),
        part({
            name: 'part-2',
            rows: '2',
            compressed_bytes: '3',
            uncompressed_bytes: '4',
            total_parts: '2',
            active_parts: '2',
        }),
    ]);
    assert.equal(snapshot.parts[0].rows, largest);
    assert.equal(snapshot.parts[0].compressedBytes, largest);
    assert.equal(snapshot.totals.rows, '18446744073709551617');
    assert.equal(snapshot.totals.compressedBytes, '18446744073709551618');
    assert.equal(snapshot.activeParts, '2');
    assert.equal(snapshot.inactiveParts, '0');
    assert.equal(snapshot.parts[0].minBlockNumber, '1');
    assert.equal(snapshot.parts[0].diskName, 'default');
    assert.equal(formatCompressionRatio(snapshot.parts[0]), '1.00×');
});

test('Parts parser preserves active and inactive rows, state totals, and signed block numbers', () => {
    const snapshot = parseMergeTreeParts('analytics', 'events', [
        part({
            total_parts: '3',
            active_parts: '2',
            inactive_parts: '1',
            min_block_number: '-2',
            max_block_number: '5',
        }),
        part({
            name: '202609_6_7_0',
            is_active: '0',
            total_parts: '3',
            active_parts: '2',
            inactive_parts: '1',
        }),
        part({ name: '202609_8_8_0', total_parts: '3', active_parts: '2', inactive_parts: '1' }),
    ]);
    assert.equal(snapshot.parts.length, 3);
    assert.equal(snapshot.parts[1].active, false);
    assert.equal(snapshot.activeParts, '2');
    assert.equal(snapshot.inactiveParts, '1');
    assert.equal(snapshot.parts[0].minBlockNumber, '-2');
    assert.equal(snapshot.parts[0].maxBlockNumber, '5');
    assert.equal(snapshot.truncated, false);
});

test('Parts query selects only system.parts fields and caps each state independently', () => {
    const query = mergeTreePartsQuery();
    assert.match(query, /FROM system\.parts/);
    assert.match(query, /min_block_number/);
    assert.match(query, /max_block_number/);
    assert.match(query, /disk_name/);
    assert.match(query, /LIMIT 500 BY active/);
    assert.doesNotMatch(query, /system\.part_log|system\.merges|\bOPTIMIZE\b/i);
});

test('Parts parser maps Playground result rows to the same active-part model', () => {
    const snapshot = parseMergeTreeParts('analytics', 'events', [
        [
            '202609',
            '202609_4_8_2',
            1,
            '12000',
            '3',
            '2048',
            '4096',
            '2',
            '-4',
            '8',
            '2026-09-24 08:00:00',
            'fast-ssd',
            '1',
            '1',
            '0',
        ],
    ]);
    assert.equal(snapshot.parts[0].active, true);
    assert.equal(snapshot.parts[0].minBlockNumber, '-4');
    assert.equal(snapshot.parts[0].maxBlockNumber, '8');
    assert.equal(snapshot.parts[0].diskName, 'fast-ssd');
    assert.equal(snapshot.activeParts, '1');
});

test('Parts parser enforces the cap, keeps server total, and normalizes unsafe values', () => {
    const snapshot = parseMergeTreeParts(
        'analytics',
        'events',
        [
            part({
                rows: '-1',
                compressed_bytes: '1.5',
                uncompressed_bytes:
                    '999999999999999999999999999999999999999999999999999999999999999999999999999999999',
                total_parts: '4',
                active_parts: '3',
                inactive_parts: '1',
            }),
            part({ name: 'part-2', total_parts: '4', active_parts: '3', inactive_parts: '1' }),
            part({ name: 'part-3', total_parts: '4', active_parts: '3', inactive_parts: '1' }),
            part({
                name: 'part-4',
                is_active: '0',
                total_parts: '4',
                active_parts: '3',
                inactive_parts: '1',
            }),
        ],
        2,
    );
    assert.equal(snapshot.parts.length, 2);
    assert.equal(snapshot.totalParts, '4');
    assert.equal(snapshot.activeParts, '3');
    assert.equal(snapshot.inactiveParts, '1');
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.parts[0].rows, '0');
    assert.equal(snapshot.parts[0].compressedBytes, '0');
    assert.equal(snapshot.parts[0].uncompressedBytes, '0');
});

test('Part treemap weights stay finite for very large values and retain zero-size parts', () => {
    const parts = parseMergeTreeParts('db', 'events', [
        part({ compressed_bytes: '18446744073709551615' }),
        part({ name: 'zero-size', compressed_bytes: '0' }),
    ]).parts;
    const values = scalePartMetrics(parts, 'compressedBytes');
    assert.equal(values[0] > 0, true);
    assert.equal(values[1], 0);
    assert.ok(values.every(value => Number.isFinite(value) && value <= 2 ** 48));
    assert.equal(scalePartMetrics(parts, 'rows').length, 2);
    assert.equal(scalePartMetrics(parts, 'marks').length, 2);
});

test('Empty and malformed rows produce a safe empty snapshot', () => {
    const snapshot = parseMergeTreeParts('db', 'events', [null, 4, 'ignored']);
    assert.equal(snapshot.parts.length, 0);
    assert.equal(snapshot.totalParts, '0');
    assert.equal(snapshot.truncated, false);
    assert.equal(snapshot.totals.compressedBytes, '0');
});
