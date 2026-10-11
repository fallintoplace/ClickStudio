import assert from 'node:assert/strict';
import test from 'node:test';
import {
    nativeGeoType,
    normalizeGeoGeometry,
    prepareGeoFeatures,
    recommendGeo,
} from '../../.core-build/src/frontend/workspace/results/maps/geo.js';

test('Geo recommends native ClickHouse geometry before numeric coordinates', () => {
    const columns = [
        { name: 'name', type: 'String' },
        { name: 'location', type: 'Point' },
        { name: 'longitude', type: 'Float64' },
        { name: 'latitude', type: 'Float64' },
        { name: 'visits', type: 'UInt64' },
    ];
    assert.deepEqual(recommendGeo(columns), {
        source: { mode: 'geometry', column: 1 },
        label: 0,
        measure: 4,
        swapCoordinates: false,
        reason: 'Native ClickHouse Point column',
    });
});

test('Geo pairs latitude and longitude columns with the same prefix', () => {
    const recommendation = recommendGeo([
        { name: 'dropoff_longitude', type: 'Float64' },
        { name: 'pickup_latitude', type: 'Float64' },
        { name: 'pickup_longitude', type: 'Float64' },
        { name: 'dropoff_latitude', type: 'Float64' },
        { name: 'trips', type: 'UInt64' },
    ]);
    assert.deepEqual(recommendation?.source, { mode: 'coordinates', longitude: 0, latitude: 3 });
    assert.equal(recommendation?.measure, 4);
});

test('Geo unwraps nullable native types and swaps H3 boundary coordinates', () => {
    assert.equal(nativeGeoType('Nullable(Point)'), 'Point');
    assert.deepEqual(
        normalizeGeoGeometry(
            [
                [51.5, -0.2],
                [51.6, -0.1],
                [51.5, -0.2],
            ],
            'Ring',
            true,
        ),
        {
            type: 'Polygon',
            coordinates: [
                [
                    [-0.2, 51.5],
                    [-0.1, 51.6],
                    [-0.2, 51.5],
                ],
            ],
        },
    );
});

test('Geo prepares only valid geographic rows and preserves retained evidence', () => {
    const columns = [
        { name: 'name', type: 'String' },
        { name: 'location', type: 'Point' },
        { name: 'trips', type: 'UInt64' },
    ];
    const recommendation = recommendGeo(columns);
    assert.ok(recommendation);
    const prepared = prepareGeoFeatures(
        [
            ['Berlin', [13.405, 52.52], 10],
            ['Outside bounds', [181, 52], 20],
        ],
        columns,
        recommendation,
    );
    assert.equal(prepared.totalFeatures, 1);
    assert.equal(prepared.invalidRows, 1);
    assert.equal(prepared.features[0]?.label, 'Berlin');
    assert.equal(prepared.features[0]?.measure, 10);
    assert.deepEqual(prepared.features[0]?.row, ['Berlin', [13.405, 52.52], 10]);
});

test('Mixed Geometry infers points, lines, and closed rings from retained JSON', () => {
    assert.deepEqual(normalizeGeoGeometry([13.4, 52.5], 'Geometry'), {
        type: 'Point',
        coordinates: [13.4, 52.5],
    });
    assert.equal(
        normalizeGeoGeometry(
            [
                [13.4, 52.5],
                [13.5, 52.6],
            ],
            'Geometry',
        )?.type,
        'LineString',
    );
    assert.equal(
        normalizeGeoGeometry(
            [
                [13.4, 52.5],
                [13.5, 52.6],
                [13.4, 52.5],
            ],
            'Geometry',
        )?.type,
        'Polygon',
    );
});

test('Geo prepares retained ClickHouse text geometry without requiring rerun decoding', () => {
    const columns = [
        { name: 'city', type: 'String' },
        { name: 'location', type: 'Point' },
        { name: 'events', type: 'UInt64' },
    ];
    const recommendation = recommendGeo(columns);
    assert.ok(recommendation);
    const prepared = prepareGeoFeatures(
        [
            ['Berlin', '(13.405,52.52)', 120],
            ['Paris', '(2.3522,48.8566)', 95],
            ['London', '(-0.1276,51.5072)', 140],
            ['Madrid', '(-3.7038,40.4168)', 80],
        ],
        columns,
        recommendation,
    );
    assert.equal(prepared.totalFeatures, 4);
    assert.equal(prepared.invalidRows, 0);
    assert.deepEqual(prepared.features[0]?.geometry, {
        type: 'Point',
        coordinates: [13.405, 52.52],
    });
    assert.equal(prepared.features[0]?.label, 'Berlin');
});
