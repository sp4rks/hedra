---
status: accepted
---

# Controllers implement an independent REST contract

ControllerInterface and BaseController represent create, id, list, update and delete calls, receiving Hono context and the collection per operation. They are not parameterized by a resource or schema; the default implementation manages server-owned metadata, uses the shared generic backend and projects every returned resource through the collection's public output validator. Programmatic resource operations remain a separate HTTP-independent helper for ConfigStore. This supersedes [ADR 0008](0008-controller-data-contracts.md)'s controller interpretation while retaining pure caller-side input validation, generic storage and shared-backend ownership. Automatic routing remains deferred.

[ADR 0012](0012-atomic-candidate-validation.md) revises validation placement: web validates public request fields, while controllers validate the complete proposed resource inside the datastore transaction before persistence. The independent controller interface and ConfigStore separation remain. Automatic routing is implemented by the subsequent Web-layer feature.

[ADR 0019](0019-config-datastore.md) adds a configuration datastore contract to Hedra and lets ConfigStore configure and own its default backend. Injected dependencies retain their shared-backend ownership rules.
