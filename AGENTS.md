# AGENTS.md

[README.md](README.md) defines Hedra. Its design goals settle trade-offs.

Hedra runs as a Bun process in a container wherever it is deployed. Use no Cloudflare Workers or other cloud-specific runtime APIs, whatever the house defaults say.

Code follows [CODING_STYLE.md](CODING_STYLE.md). `bun run check` enforces types, formatting, import order, lint and tests; `bun run fmt` fixes formatting and import order.

## Feature workflow

The **lead agent** owns design, test design, documentation and acceptance. The configured **coder** implements the work, and the configured **reviewer** performs an independent read-only review. Each stage finishes before the next starts, except implementation and docs, which run in parallel. Worktrees live in `.worktrees/<branch-name>`, which git ignores.

The agents manage planning, test boundaries, tests, implementation and review within the user's requested scope. The lead confirms test seams for the TDD workflow and adjusts coverage as needed. User approval is required only for merging into `main`; ask for clarification when a missing product or scope decision prevents progress, rather than requesting design or test-plan sign-off.

1. **Request.** The user describes the feature.
2. **Clarify.** The lead resolves missing behaviour or scope decisions, using the `grilling` skill where useful, and makes routine implementation choices autonomously. Done when the requested behaviour and constraints are clear.
3. **Design.** The lead records the behaviour, public interface (Zod schemas, routes, exports), code structure and design trade-offs in `plans/<feature>.md`, committed with the feature. Done when the lead accepts the design against the requested scope.
4. **Test design.** The lead owns the tests, following the `tdd` skill: each behaviour and failure path is named as a test and placed at a public seam. Add them to the plan. Done when the lead accepts the test boundaries and coverage; no user sign-off is needed.
5. **Implement and document.** The lead commits the plan to `feature/<feature>`, creates a worktree for that branch, and starts the coding agent in it. While it works, the lead writes the user docs with the `user-docs` skill on `feature/<feature>-docs`, in a separate worktree, touching only `docs/` and `examples/`.
   - The coding agent writes the agreed tests first and sees them fail, then implements until they pass and runs `bun run check`. It reports the commit range and check results.
   - The docs' examples fail until the code lands. The docs are done when the `user-docs` newcomer review is clean.
6. **Review.** The lead merges the docs branch into `feature/<feature>` and runs the checks and the docs' examples. Where an example fails, the lead fixes the docs if they stray from the plan, and otherwise sends the failure to the coding agent. The lead reviews the commit range with the `reviewer` skill, against the plan and docs. It sends confirmed findings back to the same coding agent to fix, then re-reviews. Done when the review has no actionable findings and every check passes. The lead then reports the result to the user and merges to `main` only after the user approves.

A decision that outlives the feature becomes an ADR during design.

## Small changes

A bug fix or small change that alters no public interface and needs no design decision takes a light path. The lead states the change and its test in a short brief, then hands it to the coding agent on `fix/<slug>` in its own worktree. The coding agent writes the failing test, makes it pass and runs `bun run check`. The lead updates the user docs if users would notice the change, reviews as in stage 6, and merges after the user approves. If the change turns out to need a design decision, switch to the feature workflow.

## Decisions

Architecture decision records (ADRs) live in `docs/adr/` as `NNNN-<slug>.md`, numbered from `0001`. Each covers one decision: its context, the decision, and its consequences.

Before changing an area, read the ADRs that touch it. When work would contradict an ADR, say so and propose a new ADR that supersedes it.

## Cursor Cloud specific instructions

Bun is on `PATH`. `bun run check` is the type, lint, and test gate, and it needs no secrets or external services.

The HTTP process is `examples/01-helloworld.ts`. Bun serves that default export on `HEDRA_SERVER_PORT` (3000). `GET /` returns `Hello Hedra!` and `GET /health` returns `{ "ok": true }`. `bun run dev` reloads the library entry `src/hedra.ts`. The boot script starts the example when port 3000 is not already answering `/health`.
