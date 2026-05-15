# Domain Guide

Domain code is pure and easy to test.

## Put here

- Parsing and normalization.
- Safety validation.
- Message extraction.
- Shared protocol/data types.
- Constants that describe stable domain concepts.

## Do not put here

- `node:*` imports.
- Pi runtime imports (`@mariozechner/*`).
- Filesystem, sockets, process env, timers, model calls.
- Calls into `infra/`, `pi/`, or `tools/`.

## Testing

Tests should be deterministic and import domain modules directly.
