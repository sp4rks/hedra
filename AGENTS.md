# AGENTS.md

[README.md](README.md) defines Hedra. Its design goals settle trade-offs.

Hedra runs as a Bun process in a container wherever it is deployed. Use no Cloudflare Workers or other cloud-specific runtime APIs, whatever the house defaults say.

## Feature workflow

Two roles take part: the **lead agent**, which designs, documents and reviews with the user in chat on Claude Opus 5.5 at high effort, and the **coding agent**, the `coder` subagent (`.cursor/agents/coder.md`, on Grok 4.7 at high effort), which the lead hands implementation to. Each stage finishes before the next starts, except implementation and docs, which run in parallel.

1. **Request.** The user describes the feature.
2. **Grill.** The lead runs the `grilling` skill until the user confirms a shared understanding.
3. **Design.** The lead proposes a design: the behaviour, the public interface (Zod schemas, routes, exports), where the code lives, and how it serves the design goals. Work through it with the user, then write it to `plans/<feature>.md`, committed with the feature as the record of what was agreed. Done when the user approves the design.
4. **Test design.** The lead proposes the tests, following the `tdd` skill: each behaviour and failure path, named as a test and placed at a public seam. Add them to the plan. Done when the user approves the tests.
5. **Implement and document.** The lead commits the plan to `feature/<feature>`, creates a worktree for that branch, and starts the coding agent in it. While it works, the lead writes the user docs with the `user-docs` skill on `feature/<feature>-docs`, in a separate worktree, touching only `docs/` and `examples/`.
   - The coding agent writes the agreed tests first and sees them fail, then implements until they pass and runs the checks in `package.json`. It reports the commit range and check results.
   - The docs' examples fail until the code lands. The docs are done when the `user-docs` newcomer review is clean.
6. **Review.** The lead merges the docs branch into `feature/<feature>` and runs the checks, docs' examples included. Where an example fails, the lead fixes the docs if they stray from the plan, and otherwise sends the failure to the coding agent. The lead reviews the commit range with the `reviewer` skill, against the plan and docs. It sends confirmed findings back to the same coding agent to fix, then re-reviews. Done when the review has no actionable findings and every check passes. The lead then reports the result to the user and merges to `main` only after the user approves.

A decision that outlives the feature becomes an ADR during design.

## Decisions

Architecture decision records (ADRs) live in `docs/adr/` as `NNNN-<slug>.md`, numbered from `0001`. Each covers one decision: its context, the decision, and its consequences.

Before changing an area, read the ADRs that touch it. When work would contradict an ADR, say so and propose a new ADR that supersedes it.
