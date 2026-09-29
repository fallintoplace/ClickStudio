# ClickHouse native parser

This folder contains a local copy of the ClickHouse parser built from the source revision listed below.

## Source and build details

- Source repository: `ClickHouse/ClickHouse`
- Source PR: [#118591](https://github.com/ClickHouse/ClickHouse/pull/118591)
- Source commit: `68085149131ee43144b975f7c0ec01137208fb8a`
- Original CI artifact path: `build_wasm_parser/parser.wasm`
- Local build: `utils/wasm-parser/npm` using the upstream `npm run setup` and `npm run build` scripts with WASI SDK 33.
- License: Apache-2.0; see [LICENSE](./LICENSE).

## Local build

ClickStudio built `parser.wasm` from the exact source commit above, using the toolchain listed here.

## What the checksum identifies

The checksum identifies this local file. The upstream CI artifact uses its own build environment, so its bytes may differ.
