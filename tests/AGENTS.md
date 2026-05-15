# Tests Guide

Tests use Node's built-in test runner through `tsx`.

## Commands

- `npm test`
- `npm run test:coverage`

## Style

- Deterministic tests only.
- Prefer testing pure `src/domain/*` functions directly.
- For external behavior, test focused `src/infra/*` adapters with temp dirs/sockets.
- Keep Pi runtime tests at seams; avoid brittle UI/render assertions unless behavior requires it.

## Before commits

Run:

```sh
npm run lint
npm test
npm run test:coverage
```
