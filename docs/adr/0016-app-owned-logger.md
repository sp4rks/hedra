---
status: accepted
---

# Give each Hedra app one owned logger

The deployment model needs one logger owned by its Hedra app. Hedra creates that logger through the configured generic factory and binds `instanceId` during construction. Remove prebuilt logger injection and contextual children instead of supporting shared parent loggers. The public `Logger` interface contains only the six message-first level methods; controllers receive `app.log` directly, and message-specific context remains available through per-call fields. Standalone factory and Pino construction support initial fields, with the existing writable-destination option retained on Pino.

This supersedes the contextual-child and supplied-logger clauses of [ADR 0005](0005-backend-independent-logging.md), [ADR 0013](0013-application-models-and-routine-types.md), [ADR 0014](0014-config-owned-environment-loading.md) and [ADR 0015](0015-config-selected-logger-library.md). Their generic logging contract, application-model distinction, environment ownership and validated library selection remain in effect. No process-global logger singleton or replacement injection factory is introduced.

The factory-construction and supplied-logger restrictions are superseded by [ADR 0018](0018-class-based-logger.md). Default loggers retain the app's instance ID; custom loggers control their own context. Contextual children remain removed.
