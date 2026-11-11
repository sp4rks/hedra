---
status: superseded by ADR-0030
---

# Parent declarations select contained collection storage

Use one Resource schema for identifiable items. A Collection without `parent` owns independent
storage; a parent-declared Collection exposes nested CRUD for a field already described by its
parent's Zod model and persists inside the containing root document. This replaces a separate
EmbeddedResource marker and automatic route inference, keeping the stored shape explicit in Zod
and giving each addressable collection its own controller.

The chosen workload queries children mainly within a known parent. Containment makes complete
document reads and atomic changes straightforward, while accepting document growth, write
contention and more expensive cross-parent search. SQLite keeps child data in the root's JSON
column; physical child columns, global child search and secondary-index declarations are deferred.

Arrays, dictionaries and singleton fields retain their managed identities and existing replacement
rules. The containing root's output policy governs all child endpoints; a separate child output
validator rejects so parent reads cannot accidentally bypass it. Owned children share their parent's
lifetime. Associations remain explicit references between independent roots and block deletion
until removed; they cannot involve contained collections.

This supersedes the declaration and route-inference decisions in [ADR 0010](0010-resources-and-embedded-resources.md)
and [ADR 0027](0027-embedded-schema-interpretation.md), and revises [ADR 0028](0028-data-only-resource-scope.md):
contained calls now dispatch to the child controller, and ResourceScope.collection names that child.
Data-only selectors, complete-document validation, generic transactions and connection ownership
remain. Existing contained JSON can be retained when fields and item schemas are unchanged; callers
must replace EmbeddedResource with Resource and explicitly declare addressable children. There is
no automatic migration of separately stored resources or association links into parent documents.

[ADR 0030](0030-root-crud-and-ordinary-nested-data.md) removes parent-declared collections and all
generated nested routes. Nested values become ordinary model data changed through root CRUD;
programmatic independent references and deletion protection remain.
