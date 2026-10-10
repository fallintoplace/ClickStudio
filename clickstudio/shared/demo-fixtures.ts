export const DEMO_EXPLAIN_ANALYZE = `┌─explain─────────────────────────────────────────────────────────────────────────────┐
│ Query summary:
│   Time:        31.42 ms (planning 2.08 ms · execution 29.34 ms)
│   Read:        1.24 million rows, 18.6 MB (42.24 million rows/s., 632.1 MB/s.)
│   Peak memory: 6.42 MiB
│
│ Output: count()
│
│ Expression ((Project names + Projection))
│ │  I/O: rows 1 → 1 · 8 B → 8 B
│ │    time 1.70 us (0.0%) · parallelism 0.92/1
│ └──Aggregating
│    │  Keys:
│    │  Aggregates: count()
│    │  I/O: rows 84 → 1 (1.19%) · 672 B → 8 B
│    │    Stage (partial aggregation): time 20.40 us (0.1%) · parallelism 0.94/1
│    │    Stage (final aggregation): time 2.00 us (0.0%) · parallelism 1.00/1
│    └──Expression (Before GROUP BY)
│       │  I/O: rows 84 → 84
│       │    time 16.20 us (0.1%) · parallelism 0.91/1
│       └──Filter
│          │  I/O: rows 1.24 million → 84 (0.01%) · 18.6 MB → 1.2 KB
│          │    time 3.18 ms (10.8%) · parallelism 3.4/8
│          └──ReadFromMergeTree (demo.events)
│                Read type: Default
│                Parts: 18 | Granules: 1,240
│                I/O: rows 0 → 1.24 million · 0 B → 18.6 MB
│                  time 25.70 ms (87.6%) · parallelism 7.3/8
└────────────────────────────────────────────────────────────────────────────────────┘`;

export function demoMergeTreePartRows() {
    const rows: Array<Record<string, string>> = [];
    for (let month = 1; month <= 6; month++) {
        for (let part = 1; part <= 7; part++) {
            const rowCount = (month * 11 + part * 3) * 10_000;
            const compressed = (month * 13 + part * 5) * 1024 * 1024;
            rows.push({
                is_active: part === 7 ? '0' : '1',
                partition: `2026-${String(month).padStart(2, '0')}`,
                name: `2026${String(month).padStart(2, '0')}_${part}_${part + 4}_${Math.max(0, part - 2)}`,
                rows: String(rowCount),
                marks: String(Math.ceil(rowCount / 8192)),
                compressed_bytes: String(compressed),
                uncompressed_bytes: String(Math.round(compressed * 3.7)),
                level: String(Math.max(0, part % 4)),
                min_block_number: String(part),
                max_block_number: String(part + 4),
                modified_at: `2026-${String(month).padStart(2, '0')}-${String(Math.min(27, part * 3)).padStart(2, '0')} 08:30:00`,
                disk_name: 'default',
                total_parts: '42',
                active_parts: '36',
                inactive_parts: '6',
            });
        }
    }
    return rows.sort((left, right) => {
        const leftActive = left.is_active === '1';
        const rightActive = right.is_active === '1';
        if (leftActive !== rightActive) return leftActive ? -1 : 1;
        const leftBytes = BigInt(left.compressed_bytes ?? '0');
        const rightBytes = BigInt(right.compressed_bytes ?? '0');

        if (leftBytes === rightBytes) {
            return 0;
        }

        if (rightBytes > leftBytes) {
            return 1;
        }

        return -1;
    });
}
