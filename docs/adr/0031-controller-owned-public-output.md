---
status: accepted
---

# Controllers own public output policy

Resource models describe stored data. BaseController applies a shallow default output validator
containing the model's declared top-level fields except `password`. Construct a fresh stripping
object so undeclared root fields stay hidden and object-level refinements cannot depend on the
omitted password. Retain each field's supplied schema unchanged.

Applications select an explicit Collection.outputValidator or implement a custom controller for
other private fields and nested output. Nested objects, dictionaries, arrays, wrappers, unions,
intersections and transformations follow ordinary Zod semantics. Remove recursive schema
derivation and automatic rejection of ambiguous output compositions. Add no secret-resource kind
or framework-specific privacy markers.

This gives controllers responsibility for public responses while keeping models ordinary Zod
schemas. It avoids interpreting every schema construction to infer a policy that applications
must already supply for fields such as tokens. Existing consumers must review their nested
output policies: passwords and undeclared nested fields previously hidden by the default can
now be returned if the supplied schemas permit them. Stored data is not rewritten.

Retain unconditional BaseController output validation for create, item reads, each list item and
update; clone isolation, declared root-key selection, JSON integrity and root identity checks;
and output validation inside write transactions with no raw-data fallback. Custom controllers
remain responsible for applying their policy on every response path.

This supersedes the recursive default privacy and ambiguous-composition clauses of
[ADR 0030](0030-root-crud-and-ordinary-nested-data.md). Root-only CRUD and ordinary nested storage
remain unchanged, as do [controller contracts](0009-rest-controller-interface.md) and
[complete-candidate transactions](0012-atomic-candidate-validation.md).
