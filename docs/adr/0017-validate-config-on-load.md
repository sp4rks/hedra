---
status: accepted
---

# Validate configuration when it loads

`Config` resolves environment input, parses and validates the resulting settings, and stores the parsed values during construction. Hedra, the logger factory and the Pino implementation consume its typed properties directly, without repeating configuration validation. Subclasses supply built-in settings through `super(environment)` and may initialize additional application state. Modifications or built-in field overrides after loading are unsupported and are not revalidated by consumers. Structured log fields retain their separate validation boundary.

This preserves the Config-owned loading in [ADR 0004](0004-schema-derived-config-class.md) and supersedes the consumer-revalidation clauses of [ADR 0013](0013-application-models-and-routine-types.md), [ADR 0014](0014-config-owned-environment-loading.md) and [ADR 0015](0015-config-selected-logger-library.md). Valid loaded configurations retain their identity, and invalid environment settings still fail before startup side effects.
