# src Guide

`src/` is split by responsibility, not by technical accident.

## Folder responsibilities

- `domain/`: pure rules and data transformations.
- `infra/`: side effects and external dependencies.
- `pi/`: Pi runtime integration and lifecycle glue.
- `tools/`: registered tools, one module per tool.
- `extension.ts`: composition root only.

## Dependency direction

Allowed:

```txt
extension.ts -> tools/pi/infra/domain
tools      -> pi/infra/domain
pi         -> infra/domain
infra      -> domain
domain     -> nothing project-specific
```

Avoid reverse imports. Especially: `domain/` must not import `infra/`, `pi/`, or `tools/`.

## Before editing

Read the nested `AGENTS.md` in the target folder.
