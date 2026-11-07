---
status: accepted
---

# Let Bun own environment-file loading

Bun already loads environment files before application code runs. `Config` reads the resulting `process.env`, or an explicitly supplied environment snapshot, then applies category-defined defaults, native-value decoding and Zod validation. It performs no file I/O and does not merge ambient values into a supplied snapshot.

Remove `HEDRA_ENV_FILE`, the manual file overlay and its fallback/error policy. Use Bun's `--env-file` and `--no-env-file` flags directly, letting the runtime control file selection, precedence and file errors. This avoids maintaining a second loader and makes disabling Bun's file loading effective throughout the application. See [Bun's environment documentation](https://bun.com/docs/runtime/environment-variables).

This supersedes the environment-file clauses of [ADR 0014](0014-config-owned-environment-loading.md) and [ADR 0022](0022-concrete-config-class.md). Config construction, native value types and validation during loading remain unchanged.
