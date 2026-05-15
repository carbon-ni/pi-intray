# Infra Guide

Infra owns external dependencies and mock boundaries.

## Put here

- Filesystem and path operations.
- Unix socket client/server code.
- OS/temp/home directory access.
- `process.env` mutation.
- AI/model completion calls.
- Small adapters around external APIs.

## Rule of thumb

If a test would need to mock it, it belongs here.

## Keep infra small

Infra should expose focused functions/types. Keep business decisions in `domain/` or orchestration in `pi/`.
