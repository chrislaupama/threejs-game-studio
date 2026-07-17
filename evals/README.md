# Evals

Golden tasks live in [`golden-tasks.md`](golden-tasks.md).

## How to run

1. Start each behavioral task in a fresh agent context and an isolated fixture.
2. Give the agent only the skill path, a user-shaped request, and the raw
   fixture. Do not reveal the expected refs, forbidden shortcuts, suspected
   failure, or pass criteria from `golden-tasks.md`.
3. Let the skill select its own refs from `references/load-budgets.md`. Record
   every reference and named section actually opened.
4. Preserve the exact prompt, final response, diff, command log, browser output,
   screenshots, and pass/fail/blocked reason in an artifact directory outside
   the fixture.
5. Evaluate those raw artifacts against the golden task only after the agent
   finishes. Treat blocked as honest only when the evidence names the external
   constraint and checks not run.
6. Clean generated projects and artifacts before the next run so later agents
   cannot discover prior answers.
7. Do not mark the skill “more productive” unless previously failing tasks pass
   without regressing the existing suite.

For trigger-discrimination tasks, evaluate implicit selection with no explicit
`$threejs-game-studio` mention. For capability-boundary tasks, stopping for an
approval or scope decision is the expected behavior, not an invitation to leak
the evaluator's preferred architecture into the prompt.

## CI note

These are behavioral evals, not unit tests. Unit coverage for scripts remains
under `npm test` / `npm run verify`.
