---
status: accepted
---

# Raise explicit validation errors and propagate unexpected failures

Blanket catch-and-rethrow blocks made every Hedra operation responsible for normalising failures, adding noise while providing no additional HTTP response safety. Use `safeParse` where data is checked and raise the appropriate existing validation error explicitly, using parsed data on success. Unexpected native, storage, logger, injected-dependency and callback failures propagate unchanged; direct programmatic callers handle their original types and values. Delete the generic normalisation helper and its uses instead of replacing it with another wrapper.

Keep catches that recover, clean up, translate malformed JSON or produce a safe HTTP response, together with transactional rollback and session/connection lifetime checks. Existing generated routes still expose known client errors and redact every unexpected/internal failure as a generic 500; a global handler for custom routes, startup and background work remains separate work. This supersedes [ADR 0020](0020-hedra-error-boundaries.md)'s guarantee that every Hedra operation throws a HedraError. Error classes and their statuses remain, but no universal wrapping or attached-cause guarantee applies.
