---
status: accepted
---

# Describe resource addresses as data and keep traversal internal

Custom controllers need to distinguish a resource UUID, an embedded array UUID, a dictionary key and a singleton field without learning schema traversal or interpreting overloaded positional arguments. Generated routes provide one data-only `ResourceScope` through Hono Context, with explicit collection/resource/embedded targets, typed embedded selectors and ordered association ancestors. Existing embedded/association accessors project that same description; schema-bearing `EmbeddedField` metadata becomes internal instead of retaining competing public scope forms.

This complements [ADR 0009](0009-rest-controller-interface.md): the five nongeneric REST operations and their per-call Context/Collection arguments remain unchanged, including extra-method typing for custom controllers. It preserves [ADR 0010](0010-resources-and-embedded-resources.md)'s lifetimes and [ADR 0011](0011-backend-owned-multi-record-transactions.md)/[ADR 0012](0012-atomic-candidate-validation.md)'s atomic checks and validation. Public embedded-step consumers must migrate from schema objects and a shared selector string to field names and explicit array IDs or dictionary keys; controller calls and stored data need no migration.

Schema interpretation remains in the embedded model module as decided in [ADR 0027](0027-embedded-schema-interpretation.md). This revises that decision's unchanged-public-exports clause for scope metadata: `EmbeddedField` becomes internal and public embedded steps contain only addressing data.
