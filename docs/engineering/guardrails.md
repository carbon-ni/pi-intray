# Engineering Guardrails

This project is a Pi TypeScript extension. Guardrails make local work, CI, and landing use one command path.

## Done means

A change is done only when:

1. Requirements are covered by tests when behavior changes.
2. `make all` passes locally.
3. CI passes the same gate.
4. Docs are updated when user-facing behavior changes.

## Guardrails

### One quality gate
- Intent: Keep local validation and CI aligned.
- Operator command(s): `make all`
- Enforcement: GitHub Actions runs `make all`; pre-push hook runs `make all`.
- Failure signal: TypeScript, lint, or test command exits non-zero.
- Recovery: Run the failing command directly: `make lint` or `make test`.

### Tests for behavior changes
- Intent: Make extension behavior safe to change.
- Operator command(s): `make test`
- Enforcement: `make all`, CI, and pre-push include tests.
- Failure signal: `node:test` failure output.
- Recovery: Add or update tests in `tests/**/*.test.ts`; prefer deterministic unit tests.

### Type safety before runtime testing
- Intent: Catch API and module boundary mistakes early.
- Operator command(s): `make typecheck`
- Enforcement: `make lint` and `make all` include `npm run typecheck`.
- Failure signal: `tsc --noEmit` exits non-zero.
- Recovery: Fix type errors or add precise types where useful.

### Security check is explicit
- Intent: Surface vulnerable dependency trees before landing.
- Operator command(s): `make security-check`
- Enforcement: CI runs `make security-check`; pre-push runs it via `make all`.
- Failure signal: `npm audit --audit-level=moderate` exits non-zero.
- Recovery: Upgrade dependency, document false positive, or lower risk with justification.

### Single configuration source
- Intent: Avoid competing tool configuration.
- Operator command(s): `npm run typecheck`, `npm test`
- Enforcement: `tsconfig.json`, `package.json`, and `Makefile` are canonical.
- Failure signal: Duplicate configs or commands disagree.
- Recovery: Update canonical commands first, then docs and CI.

### Extension boundary stays narrow
- Intent: Keep Pi integration and testable parsing/helpers separated.
- Operator command(s): `make test`
- Enforcement: Tests import exported pure helpers from `index.ts`.
- Failure signal: Behavior requires live Pi session to test.
- Recovery: Extract pure helper, test it, then wire it to Pi runtime.

## Anti-patterns

- CI-only checks with no local command.
- Untested parser, socket, or command behavior changes.
- Multiple ways to run the same lifecycle step.
- Broad rewrites mixed with feature changes.
- Secrets committed in `.env` or logs.

## Failure modes

| Failure mode | Recovery command |
| --- | --- |
| Dependencies missing | `npm ci` |
| Type failures | `make typecheck` |
| Test failures | `make test` |
| Audit failures | `make security-check` |
| Hooks not installed | `make hooks-install` |
