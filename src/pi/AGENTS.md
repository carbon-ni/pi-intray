# Pi Integration Guide

`pi/` contains Pi runtime glue that is not a registered tool module.

## Put here

- Command registration and command handlers.
- Runtime/lifecycle orchestration.
- Message renderers.
- Startup flag flow.
- Event handling between Pi and infra/domain.

## Do not put here

- New registered tools. Put those in `src/tools/`.
- Raw external IO if a focused infra adapter can own it.
- Pure parsing/validation if it can live in `domain/`.

## Keep `extension.ts` thin

Move logic here when `extension.ts` starts doing more than wiring.
