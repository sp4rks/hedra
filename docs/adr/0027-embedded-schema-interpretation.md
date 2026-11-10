---
status: accepted
---

# Keep embedded-schema interpretation in the embedded model module

`src/models/embedded.ts` owns discovery of embedded fields, optional/nullable/default unwrapping,
container and item definitions, input-validator derivation, and compatibility of exposed embedded
output schemas. Routes consume these definitions to check and register paths. Controllers and server
registration consume the same field definitions for their own operations. Collection declarations,
controller methods, public exports and stored data keep their existing contracts.

Routes previously interpreted explicit output containers separately from stored-field discovery.
Keeping that knowledge together gives schema changes one home without adding a registration cache
or prepared-definition lifecycle. An omitted output field has no generated embedded route; an exposed
field must retain its container kind and a required UUID item identity. Output item schemas need not
carry the resource-kind metadata used to identify stored EmbeddedResource declarations.

Schema interpretation does not determine every operation's policy. Mutation reconciles incoming
identities and timestamps; complete-candidate validation rejects changes to managed metadata and
embedded identity; output projection may hide fields and filter or reorder arrays while preserving
each retained identity. These traversals stay distinct in their controllers. Raw dictionary-key
addressability checks stay in routes, before input parsing can discard unsafe literal keys.

This keeps the resource lifetimes in [ADR 0010](0010-resources-and-embedded-resources.md), the generic
transactions in [ADR 0011](0011-backend-owned-multi-record-transactions.md), complete-candidate checks
in [ADR 0012](0012-atomic-candidate-validation.md) and errors in
[ADR 0025](0025-explicit-validation-errors.md). Candidate validation and output checks still run
inside mutation transactions so failures roll back the entire write. See the
[embedded-resource reference](../web-layer.md) for supported declarations and routes.
