# AGENTS.md

[IDEA.md](IDEA.md) defines Hedra. Its design goals settle trade-offs.

Hedra runs as a Bun process in a container wherever it is deployed. Use no Cloudflare Workers or other cloud-specific runtime APIs.

Code follows [CODING_STYLE.md](CODING_STYLE.md).

## Project requirements

Follow the [shared delivery workflow](/home/sparks/.agents/AGENTS.md#design-and-development), with these requirements:

- Apply the stages to each coherent slice; independent slices may overlap.
- The configured coder implements every software change, including bug fixes and small changes.
- The lead accepts design and test plans within the agreed scope; user sign-off is not required. Ask the user when a missing product or scope decision prevents progress.
- Every software change requires `bun run check`, lead review of the fixed commit range and independent read-only review by the configured reviewer. Acceptance requires passing checks and no actionable findings.
- Use `feature/<feature>` for features and `fix/<slug>` for bug fixes or small changes without a public-interface or design change.
- User approval is required before merging into `main`.
- Follow the [Codex managed-worktree procedure](/home/sparks/.codex/AGENTS.md#worktrees) for implementation and cleanup. After approved integration and verification, archive the task's worktrees through Codex.

Handle instruction-only changes directly in the task's existing checkout with link and meaning checks.

## Decisions

Before changing an area, read its applicable ADRs. If a change contradicts one, explain the trade-off.
