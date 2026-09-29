# ClickHouse native parser

This folder contains a local copy of the ClickHouse parser built from the source revision listed below.

## Source and build details

- Source repository: `ClickHouse/ClickHouse`
- Source PR: [#118591](https://github.com/ClickHouse/ClickHouse/pull/118591)
- Source commit: `68085149131ee43144b975f7c0ec01137208fb8a`
- Original CI artifact path: `build_wasm_parser/parser.wasm`
- Local build: `utils/wasm-parser/npm` using the upstream `npm run setup` and `npm run build` scripts with WASI SDK 33.
- License: Apache-2.0; see [LICENSE](./LICENSE).

## Why this copy was built locally

The original CI artifact is the file produced by the source project's automated build. Its download URL was not accessible when this parser was added to ClickStudio.

For that reason, `parser.wasm` was rebuilt from the exact source commit listed above.

## What the checksum identifies

The checksum identifies the bytes of the copy stored here. It does not claim that this local build is byte-for-byte identical to the original CI artifact.
