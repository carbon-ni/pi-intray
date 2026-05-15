# Tools Guide

This folder is the source of truth for registered extension tools.

## Structure

- One registered tool per module.
- Use `index.ts` only as the tool export/registry barrel.
- File names should describe the tool capability in kebab-case.

## Adding a tool

1. Create one module for the tool.
2. Register exactly one `pi.registerTool(...)` in that module.
3. Export its registration function from the folder index.
4. Wire it in `src/extension.ts` only when composition or feature flags require it.
5. Move reusable parsing/validation to `src/domain/`.
6. Move external calls to `src/infra/`.

## Keep modules readable

If a tool grows too large, extract pure decisions to `domain/` and external interactions to `infra/`; keep the tool module as Pi-facing orchestration.
