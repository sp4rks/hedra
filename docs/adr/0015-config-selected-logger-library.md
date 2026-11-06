---
status: accepted
---

# Select the logger library behind the generic interface

Hedra's server depends only on `Logger` and a generic `createLogger` factory. The factory selects an implementation using the validated `HEDRA_SERVER_LOG_LIBRARY` setting, whose default and only accepted value is currently `pino`. Pino's implementation and native types stay in its adapter module; the generic contract has no Pino dependency. Supplied logger instances retain their identity and independent app-bound children, while configuration validation remains mandatory.

This extends [ADR 0005](0005-backend-independent-logging.md). Library selection is separate from JSON/pretty output formatting, and unsupported libraries fail configuration validation rather than silently selecting a default. A finite setting and a simple factory keep selection explicit without a plugin registry or imports derived from environment values.
