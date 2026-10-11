# ClickHouse documentation data

## What the catalog contains

`src/shared/database/reference/offline-reference-catalog.json` contains short text excerpts and SQL examples adapted from the ClickHouse documentation by ClickHouse contributors. Each entry links to its source page.

The app uses this catalog as an offline reference.

## Source and license

The catalog was generated from [ClickHouse/ClickHouse](https://github.com/ClickHouse/ClickHouse) at revision [`5b0395f4d189d9e5a3ee36d7af63f5ffb51ffaa2`](https://github.com/ClickHouse/ClickHouse/commit/5b0395f4d189d9e5a3ee36d7af63f5ffb51ffaa2). This catalog is available under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). A copy of the license is in `CLICKHOUSE-DOCS-LICENSE.txt`.

The CC BY-NC-SA 4.0 license applies to the catalog data. ClickStudio application code has its own license.

## Regenerate the catalog

Run this command from the `clickstudio/` folder:

```sh
node scripts/generate-offline-reference.mjs /path/to/ClickHouse/docs/reference clickhouse-commit-sha
```

Set `/path/to/ClickHouse/docs/reference` to the reference folder in your local ClickHouse checkout. Set `clickhouse-commit-sha` to that checkout's commit ID.
