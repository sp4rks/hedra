---
status: accepted
---

# Manage tenants through the configuration catalogue

Tenant definitions already belong to the configuration datastore. Their built-in REST routes therefore use its structural tenant operations rather than registering an application collection or requiring access to its backend. This preserves the lazy construction, replaceable storage and connection ownership established by [ADR 0019](0019-config-datastore.md), while reserving `/tenants` and enforcing the deployment API hostname at the controller boundary.

Each tenant has a required, canonical domain that cannot change after creation. The default configuration store validates tenant writes and checks domain uniqueness atomically through the generic backend; injected configuration datastores uphold the same invariants. This specialises the previously model-independent configuration operations described by [ADR 0009](0009-rest-controller-interface.md) without adding tenant methods to Backend. The HTTP layer additionally checks that a new tenant domain is a direct subdomain of this app's deployment domain. Host selection supplies no authentication or application-data isolation, and existing name-only definitions require an explicitly assigned domain before use with the new API.
