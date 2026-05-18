.PHONY: all typecheck lint test security-check hooks-install hooks-uninstall

all: lint test security-check

typecheck:
	npm run typecheck

lint:
	npm run lint

test:
	npm test

security-check:
	npm audit --audit-level=moderate

hooks-install:
	git config core.hooksPath .githooks
	chmod +x .githooks/pre-commit .githooks/pre-push .githooks/commit-msg

hooks-uninstall:
	git config --unset core.hooksPath || true
