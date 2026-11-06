---
status: accepted
---

# Controllers implement an independent REST contract

ControllerInterface and BaseController represent create, id, list, update and delete calls, receiving Hono context and the collection per operation. They are not parameterized by a resource or schema; the default implementation manages server-owned metadata, uses the shared generic backend and projects every returned resource through the collection's public output validator. Programmatic resource operations remain a separate HTTP-independent helper for ConfigStore. This supersedes [ADR 0008](0008-controller-data-contracts.md)'s controller interpretation while retaining pure caller-side input validation, generic storage and shared-backend ownership. Automatic routing remains deferred.
