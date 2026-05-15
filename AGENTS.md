# Agent Index

Use this file as the project map. Read the closest `AGENTS.md` before editing a folder.

## Architectural intent

Keep extension code easy to navigate by separating responsibilities:

- `src/domain/` — pure business rules. No runtime APIs, no IO, no infra imports.
- `src/infra/` — external dependencies and mock boundaries.
- `src/pi/` — Pi extension integration and runtime glue.
- `src/tools/` — registered tool modules. This folder should make available tools discoverable.
- `tests/` — deterministic tests around behavior and seams.

## Rules for future changes

1. Add or change tools in `src/tools/`.
2. Put pure parsing, validation, formatting, and data shaping in `src/domain/`.
3. Put any dependency you would mock in tests in `src/infra/`.
4. Keep `src/extension.ts` as composition only: register flags, tools, commands, renderers, and hooks.
5. Run before committing:
   - `npm run lint`
   - `npm test`
   - `npm run test:coverage`

## Reports

Write task reports under `.tmp/reports/<dd-mm-yy>/` if `$AGENT_WORKSPACE` is not set.
