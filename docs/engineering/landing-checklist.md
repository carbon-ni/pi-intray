# Landing Checklist

Before commit or push:

- [ ] Behavior change has tests in `tests/**/*.test.ts`.
- [ ] User-facing change updates `README.md` or `docs/engineering/*`.
- [ ] `make all` passes locally.
- [ ] `git status` contains only intentional files.
- [ ] Commit message states intent, not mechanics.
- [ ] CI passes after push.

If any item fails, do not land. Fix or explicitly document why it is blocked.
