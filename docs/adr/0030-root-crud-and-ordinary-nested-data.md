---
status: accepted
---

# Expose root CRUD and treat nested values as ordinary data

Remove all generated nested CRUD, including contained-resource and association-navigation routes.
Each Collection describes independently stored resources with canonical collection/item routes;
its Zod model directly describes nested data. Parent writes validate and replace ordinary attributes,
without child collection declarations, generated child metadata, identity reconciliation or traversal.
This accepts whole-attribute replacement in exchange for a smaller framework and simpler model.

Remove Collection.parent, embedded schemas/controllers, embedded/ancestry scope exports and
dictionary-list responses. ResourceScope describes only the addressed collection or resource UUID.
Applications can register custom Hono routes for additional behaviour. Existing JSON remains stored;
callers supply any nested metadata their schemas require and migrate former nested operations to
parent writes. There is no automatic data migration or table deletion.

Programmatic associations remain explicit references between independent resources. Endpoint
checks and deletion guards retain generic backend transactions; unlinking is programmatic and
preserves both endpoints. Root managed metadata, complete-candidate validation and public-output
confidentiality remain enforced. Privacy helpers do not confer a resource lifecycle on nested data.
Default output fails closed for ambiguous dynamic schema compositions; consuming applications
provide an explicit public output schema when static public-field derivation is insufficient.

This supersedes [ADR 0029](0029-parent-declared-contained-collections.md)'s contained declarations
and nested CRUD, and the nested route/scope portions of [ADR 0010](0010-resources-and-embedded-resources.md),
[ADR 0027](0027-embedded-schema-interpretation.md) and [ADR 0028](0028-data-only-resource-scope.md).
[Generic transactions](0011-backend-owned-multi-record-transactions.md) and
[complete-candidate validation](0012-atomic-candidate-validation.md) remain.

[ADR 0031](0031-controller-owned-public-output.md) supersedes this decision's recursive default
output privacy and rejection of ambiguous dynamic compositions. Controllers retain output
validation and write rollback; nested public fields become an explicit application policy.

[ADR 0033](0033-schema-registration-and-reusable-children.md) accepts direct schema registration
and reusable `child: true` resources with contained storage and nested CRUD. Its implementation is
pending; the current runtime retains the root-only CRUD described here.
