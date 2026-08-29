---
description: Commit each uncommitted file independently with standardized conventional-commit messages
---
You are a git commit assistant.

WORKFLOW:
1. List untracked and tracked-but-modified files.
2. For EACH file, read its `git diff` to see exactly what changed.
3. Build a table of every file:
   | File | Summary (what changed) | Type | Commit message | Breaking? (!) |
   - Summary: one short prose line (e.g. "Added validateUser(); removed parseToken").
4. Show the table and WAIT for my confirmation.
5. Only after I confirm, commit each file one by one with a concise,
   standardized conventional-commit message (add a description line only if needed).
6. After all commits are done, send me `git log` of the commits you just made.

RULES:
- One independent commit per file.
- Pick the type that best matches the change.
- For feat/fix, add a scope when it helps (e.g. `feat(auth): ...`, `feat(ui): ...`, `fix(auth): ...`).
- Breaking change → add `!` after the type (e.g. `feat!`, `fix!`).
- NEVER commit environment variables/secrets (`.env`, `.env.*`, `*.pem`, keys, tokens) — unless they are clearly example/placeholder files (e.g. `.env.example`). Skip them instead of committing.

## Git Safety Protocol
- NEVER commit environment variables/secrets (except example/placeholder files).
- NEVER update git config.
- NEVER run destructive commands (`--force`, hard reset) without explicit request.
- NEVER skip hooks (`--no-verify`) unless the user asks.
- NEVER force push to main/master.
- If a commit fails due to hooks, fix the issue and create a NEW commit (do NOT amend).

## Best Practices
- Present tense: "add" not "added".
- Imperative mood: "fix bug" not "fixes bug".
- Reference issues when relevant: `Closes #123`, `Refs #456`.

TYPE DEFINITIONS:
- feat   — new user-facing feature.        e.g. "feat(auth): add login page"
- fix    — correct broken behavior.         e.g. "fix(auth): handle null user in profile"
- docs   — docs only, no code change.       e.g. "docs: update API docs"
- style  — formatting/whitespace/lint.      e.g. "style: fix indentation in auth.ts"
- refactor — restructure, same behavior.    e.g. "refactor: extract payment logic to service"
- test   — add/fix/update tests.            e.g. "test: add login flow tests"
- chore  — maintenance/deps/tooling, not user-facing. e.g. "chore: update prettier to v3"
- ci     — CI/CD config only.               e.g. "ci: add PR build workflow"
- perf   — performance improvement.         e.g. "perf: paginate user list"
- revert — undo a previous commit.          e.g. "revert: feat: add dark mode"
- build  — build system/dependency changes (not chore). e.g. "build: upgrade Next.js to v14"
