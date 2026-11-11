# AGENTS.md

[IDEA.md](IDEA.md) defines Hedra. Its design goals settle trade-offs.

Hedra runs as a Bun process in a container wherever it is deployed. Use no Cloudflare Workers or other cloud-specific runtime APIs.

Code follows [CODING_STYLE.md](CODING_STYLE.md). `bun run check` enforces types, formatting, import order, lint and tests; `bun run fmt` fixes formatting and import order.

## Feature workflow

The **lead** owns design, test design, documentation and acceptance; the configured **coder** implements; the configured **reviewer** performs an independent read-only review. Finish each stage before the next, except implementation and documentation, which run in parallel. Worktrees live in gitignored `.worktrees/<branch-name>`.

The lead makes routine design decisions and confirms test seams within the requested scope. Ask the user when a missing product or scope decision prevents progress; design and test plans need no user sign-off. User approval is required before merging into `main`.

1. **Clarify.** Resolve missing behaviour and constraints, using `grilling` where useful.
2. **Design.** Create or reuse `feature/<feature>` and its worktree. Record behaviour, public interface (Zod schemas, routes, exports), code structure and trade-offs in `plans/<feature>.md` there. The lead accepts the design against the requested scope.
3. **Test design.** Following `tdd`, name each behaviour and failure path as a test at a public seam in the plan. The lead accepts the boundaries and coverage.
4. **Implement and document.** Start the coder in that feature worktree. The coder writes each agreed failing test, makes it pass, runs `bun run check` and reports the commit range and checks. In parallel, the lead writes docs with [docs-style](/home/sparks/.agents/skills/personal/docs-style/SKILL.md) and [Diátaxis](/home/sparks/.agents/skills/personal/house-standards/Diataxis.md) in that same feature worktree, touching only `docs/` and `examples/`. Complete a newcomer review: examples run from their stated starting point and references are accurate. Examples may fail until implementation lands.
5. **Review.** Review the code and documentation together; run checks and docs examples. Fix docs that stray from the plan; send other example failures to the coder. The lead reviews the fixed commit range against the plan and docs, and the configured reviewer independently applies the [reviewer skill](/home/sparks/.agents/skills/personal/reviewer/SKILL.md). Send confirmed findings to the same coder, rerun affected checks and re-review. Acceptance requires no actionable findings and passing checks. Report the result and merge to `main` only after user approval.

## Small changes

For a code bug fix or small code change with no public interface or design decision, the lead briefs the change and its test, then assigns the coder on `fix/<slug>` in its own worktree. For behaviour changes, the coder writes the failing test and makes it pass. Software changes require `bun run check`. The lead updates user docs when needed and reviews as in the feature workflow. Switch to that workflow if a design decision arises.

Handle instruction or documentation-only changes in the task's existing checkout with link and meaning checks; create no separate documentation branch or worktree.

## Decisions

Record durable architectural trade-offs and significant constraints that need future context in `docs/adr/NNNN-<slug>.md`, numbered from `0001`. Each ADR covers one decision, its context and consequences. Before changing an area, read its applicable ADRs; if a change contradicts one, say so and propose a superseding ADR.
