---
status: accepted
---

# Let Config own application environment loading

Hedra constructs `Config()` when no configuration is supplied, letting that class resolve the process environment, environment files and defaults. Its constructor accepts only the `config`, `logger` and `backend` dependencies; the redundant `env` shortcut and `env`/`config` conflict check are removed. Explicit `Config(environment)` construction remains available for isolated tests and supplied configurations, whose identity and validation Hedra preserves.

This supersedes the environment-option clause of [ADR 0013](0013-application-models-and-routine-types.md). The distinction between application models and routine wiring, including ignoring unknown option properties at runtime, remains in effect. Existing callers using the removed shortcut must construct a `Config` explicitly or rely on normal process environment loading.

The supplied-logger clause is superseded by [ADR 0016](0016-app-owned-logger.md).

The consumer-revalidation clause is superseded by [ADR 0017](0017-validate-config-on-load.md).

Environment-file loading is superseded by [ADR 0023](0023-bun-owned-environment-files.md). Hedra still constructs `Config()` by default, and explicit environment snapshots remain available.
