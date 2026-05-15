# Commands

## Setup

```bash
npm ci
make hooks-install
```

## Daily workflow

```bash
# inspect current state
git status

# run fast feedback
make lint
make test

# run complete local gate
make all
```

## Quality gates

```bash
make typecheck        # TypeScript compile check
make lint             # project lint gate, currently typecheck
make test             # node:test suite through tsx
make security-check   # npm audit at moderate severity
make all              # lint + tests + security check
```

## Git hooks

```bash
make hooks-install    # use versioned hooks in .githooks/
make hooks-uninstall  # return to default .git/hooks
```

## Landing

```bash
make all
git status
git add <files>
git commit -m "<type>: <summary>"
git push
```
