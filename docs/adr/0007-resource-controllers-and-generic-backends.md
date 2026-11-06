---
status: accepted
---

# Resource controllers own behaviour and backends provide generic persistence

Controllers own model validation and resource operations, including UUID generation by the default controller. Collections bind the resource model, storage name, endpoint metadata, and controller selection; model-agnostic backends provide `insert`, `select`, `update`, and `delete` for named tables, with atomic updates invoking controller-supplied validation. Backends retain connection ownership, and callers close a shared backend only after all users finish. This supersedes [ADR 0001](0001-model-driven-collection-crud.md) and [ADR 0006](0006-backend-owned-datastore-connections.md) so resource behaviour can be reused across storage and a future web layer without domain-specific database methods.
