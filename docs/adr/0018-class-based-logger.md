---
status: accepted
---

# Construct the default logger and accept replacements through an interface

Logging should follow Hedra's interface and class pattern. Export the six-method contract as `LoggerInterface` and expose the default Pino implementation as `Logger`, constructible with optional configuration, destination and initial fields. Hedra constructs this class directly when no logger is supplied, avoiding a factory and forwarding layer for the only supported default implementation. Configuration still accepts only `pino` as the default library and validates settings when loaded.

Applications can supply `logger?: LoggerInterface` to Hedra, which retains the exact instance without wrapping, mutation or cleanup. This lets independent classes replace logging without inheriting private Pino state. Default app loggers retain their app's instance ID; custom implementations own their context, validation, output and lifetime. Contextual children remain removed.

This supersedes the factory-selection clause of [ADR 0015](0015-config-selected-logger-library.md) and the factory-construction and supplied-logger restrictions of [ADR 0016](0016-app-owned-logger.md). The generic logging contract, Config-owned validation, default logging behaviour and backend lifecycle remain in effect. `createLogger` and `PinoLogger` are removed; callers construct `Logger`, and replaceable dependencies use `LoggerInterface`.
