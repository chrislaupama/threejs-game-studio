# Evals

Golden tasks live in [`golden-tasks.md`](golden-tasks.md).

## How to run

1. Start from a clean git state or an isolated temp directory.
2. For each task, load only the listed refs from `references/load-budgets.md`.
3. Execute the task as an agent or human following `SKILL.md`.
4. Record pass/fail/blocked with command output paths and captures.
5. Do not mark the skill “more productive” unless previously failing tasks pass.

## CI note

These are behavioral evals, not unit tests. Unit coverage for scripts remains
under `npm test` / `npm run verify`.
