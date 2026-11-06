---
status: accepted
---

# Give Hedra its own logging interface

Hedra exposes message-first level methods, structured fields and independent contextual children through its own `Logger` interface, with `PinoLogger` as the default implementation. Output configuration describes JSON or pretty formatting rather than library names, so applications can replace the backend without coupling Hedra to its methods or types. Each app binds its own `instanceId` through a child logger; Pino-specific capabilities remain inside the adapter instead of becoming part of Hedra's public contract.

The contextual-child and supplied-logger clauses are superseded by [ADR 0016](0016-app-owned-logger.md).
