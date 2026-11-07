---
status: accepted
---

# Normalize operation failures into the Hedra error hierarchy

Hedra already defines status-bearing error classes, but explicit native errors and unwrapped Zod,
filesystem and SQLite failures require callers to handle unrelated error contracts. Normalize
failures at Hedra-owned operation boundaries into `HedraError` or an existing subclass. Preserve an
existing Hedra error unchanged; retain a wrapped failure in the standard non-enumerable `cause`.
This replaces the documented propagation of native SQLite errors while preserving validation,
transaction rollback, connection ownership and generated HTTP error redaction.

The boundary is an operation implemented by Hedra. Direct calls to exported Zod schemas and inherited
Hono APIs retain their library contracts. Injected dependencies retain their identity and ownership;
their failures are normalized when called by Hedra-owned operations. This preserves the borrowed
dependency contracts in [ADR 0018](0018-class-based-logger.md) and
[ADR 0019](0019-config-datastore.md).

Callers can catch `HedraError` consistently and inspect `cause` locally for native details. Code that
previously caught a native SQLite or Zod error from a Hedra operation must catch the Hedra wrapper
instead. Constructors, successful results and error-envelope redaction keep their existing contracts.
