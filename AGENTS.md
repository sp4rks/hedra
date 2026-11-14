# AGENTS.md

[IDEA.md](IDEA.md) defines Hedra. Its design goals settle trade-offs.

Hedra runs as a Bun process in a container wherever it is deployed. Use no Cloudflare Workers or other cloud-specific runtime APIs.

Code follows [CODING_STYLE.md](CODING_STYLE.md). `bun run check` enforces types, formatting, import order, lint and tests; `bun run fmt` fixes formatting and import order.

## Feature workflow

The **lead** owns design, test design and acceptance; the configured **coder** implements; the configured **reviewer** performs an independent read-only review. Finish each stage before the next.

Use only Codex-managed worktrees attached to the chat for implementation. Reuse a suitable attachment or create one with Codex's worktree tools from the intended base revision, then create the task branch there. The lead and coder share that worktree for the task. After approved integration and verification, preserve needed ignored files and archive the worktree through Codex so its snapshot remains restorable from the chat.

The lead makes routine design decisions and confirms test seams within the requested scope. Ask the user when a missing product or scope decision prevents progress; design and test plans need no user sign-off. User approval is required before merging into `main`.

1. **Clarify.** Resolve missing behaviour and constraints, using `grilling` where useful.
2. **Design.** Create or reuse `feature/<feature>` in the managed worktree. Define behaviour, public interface (Zod schemas, routes, exports), code structure and trade-offs. The lead accepts the design against the requested scope.
3. **Test design.** Following `tdd`, name each behaviour and failure path as a test at a public seam. The lead accepts the boundaries and coverage.
4. **Implement.** Start the coder in that feature worktree. The coder writes each agreed failing test, makes it pass, runs `bun run check` and reports the commit range and checks.
5. **Review.** The lead reviews the fixed commit range against the agreed design and acceptance checks, and the configured reviewer independently applies the [reviewer skill](/home/sparks/.agents/skills/personal/reviewer/SKILL.md). Send confirmed findings to the same coder, rerun affected checks and re-review. Acceptance requires no actionable findings and passing checks. Report the result and merge to `main` only after user approval.

## Small changes

For a code bug fix or small code change with no public interface or design decision, the lead briefs the change and its test, then assigns the coder on `fix/<slug>` in the managed worktree. For behaviour changes, the coder writes the failing test and makes it pass. Software changes require `bun run check`. The lead reviews as in the feature workflow. Switch to that workflow if a design decision arises.

Handle instruction-only changes in the task's existing checkout with link and meaning checks.

## Decisions

Before changing an area, read its applicable ADRs. If a change contradicts one, explain the trade-off.
