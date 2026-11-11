---
status: accepted
---

# Infer tenant mutation types from their schemas

Infer `TenantInput` and `TenantChanges` directly from their Zod schemas. Remove
the additional forbidden-key type mapping so tenant models follow the same
schema-derived type convention as other application models. Controllers validate
requests at runtime, and the default configuration store validates direct
programmatic calls through the same strict schemas.

TypeScript's normal structural typing can accept existing variables with extra
fields; runtime validation rejects forbidden metadata and domain changes. This
trades earlier compiler errors for simpler model definitions and supersedes the
pretyped-caller exclusion requirement in
[ADR 0026](0026-tenant-operations-contract.md). Its structural datastore contract,
read validation and runtime mutation rules remain in force.
