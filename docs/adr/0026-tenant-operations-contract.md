---
status: accepted
---

# Give the tenant catalogue its own contract and validate reads

The tenant catalogue's generic CRUD-derived interface allowed mutation fields that tenant policy rejected, while inherited reads checked only generic resource metadata. Use a structural `TenantOperationsInterface` with mutation types derived from shared strict `TenantInput` and `TenantChanges` schemas; keep forbidden metadata and domain fields excluded for pretyped callers too. ConfigStore and injected configuration datastores share this contract, and TenantController reuses the mutation schemas.

The default tenant implementation retains generic resource guards and additionally parses every selected `get`/`list` result through Tenant. It returns parsed values, rejects an invalid selected row with an output-validation error, and never silently drops rows or rewrites storage. Generic ResourceOperations remain schema-free; tenant policy stays in the tenant implementation. This extends [ADR 0019](0019-config-datastore.md) and [ADR 0024](0024-tenant-catalogue-rest-boundary.md), retaining the separate REST contract and atomic write invariants. Existing invalid tenant data now also fails programmatic reads and requires explicit correction; unexpected failures retain [ADR 0025](0025-explicit-validation-errors.md)'s propagation rules.
