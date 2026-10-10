import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeClickHouseStringValue } from '../../.core-build/shared/playground-values.js';
import { prepareGeoFeatures, recommendGeo } from '../../.core-build/shared/geo.js';

const NULL_MARKER = 'ᴺᵁᴸᴸ';

test('Playground decoding restores ClickHouse Point values from string format', () => {
    assert.deepEqual(
        decodeClickHouseStringValue('(13.405,52.52)', 'Point', NULL_MARKER),
        [13.405, 52.52],
    );
});

test('Playground decoding restores nested ClickHouse geo values', () => {
    assert.deepEqual(
        decodeClickHouseStringValue('[(13.405,52.52),(2.3522,48.8566)]', 'LineString', NULL_MARKER),
        [
            [13.405, 52.52],
            [2.3522, 48.8566],
        ],
    );
    assert.deepEqual(
        decodeClickHouseStringValue(
            '[[(13.4,52.5),(13.5,52.6),(13.4,52.5)]]',
            'Polygon',
            NULL_MARKER,
        ),
        [
            [
                [13.4, 52.5],
                [13.5, 52.6],
                [13.4, 52.5],
            ],
        ],
    );
});

test('Playground geo decoding feeds the spatial explorer retained-row model', () => {
    const columns = [
        { name: 'city', type: 'String' },
        { name: 'location', type: 'Point' },
        { name: 'events', type: 'UInt64' },
    ];
    const row = [
        'Berlin',
        decodeClickHouseStringValue('(13.405,52.52)', 'Point', NULL_MARKER),
        decodeClickHouseStringValue('120', 'UInt64', NULL_MARKER),
    ];
    const recommendation = recommendGeo(columns);
    assert.ok(recommendation);
    const prepared = prepareGeoFeatures([row], columns, recommendation);
    assert.equal(prepared.totalFeatures, 1);
    assert.equal(prepared.invalidRows, 0);
    assert.deepEqual(prepared.features[0]?.geometry, {
        type: 'Point',
        coordinates: [13.405, 52.52],
    });
    assert.equal(prepared.features[0]?.label, 'Berlin');
    assert.equal(prepared.features[0]?.measure, 120);
});

test('Playground decoding preserves malformed geo text instead of inventing geometry', () => {
    assert.equal(
        decodeClickHouseStringValue('(13.405,not-a-number)', 'Point', NULL_MARKER),
        '(13.405,not-a-number)',
    );
    assert.equal(
        decodeClickHouseStringValue('(13.405,52.52) trailing', 'Point', NULL_MARKER),
        '(13.405,52.52) trailing',
    );
});

test('Playground decoding keeps wide integers exact and nullable markers null', () => {
    assert.equal(
        decodeClickHouseStringValue('18446744073709551615', 'UInt64', NULL_MARKER),
        '18446744073709551615',
    );
    assert.equal(decodeClickHouseStringValue(NULL_MARKER, 'Nullable(Point)', NULL_MARKER), null);
});
