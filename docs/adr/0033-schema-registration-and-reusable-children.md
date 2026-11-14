---
status: accepted
---

# Register resource schemas directly and mark reusable children

Implementation is pending. The current runtime still uses Collection registration and root-only CRUD.

Consumers register Resource-derived Zod schemas directly, without constructing a public Collection.
Named root definitions use schema metadata such as `.meta({ name: 'customers' })`; Hedra owns
controller bindings, index readiness and route registration. Custom controllers and input/output
validators remain registration settings. Tenant, Environment and Resource remain the three domain
building blocks.

A resource marked `.meta({ child: true })` is contained data with managed nested CRUD. It has no
standalone table or root route and cannot be registered as a root. With `child` absent or false, an
explicitly registered named resource has its own table and root CRUD. These flags describe the
schema definition, not client-submitted record attributes.

Registering a root discovers its marked child fields. Parent field names determine the JSON
locations and nested paths: `Customer.addresses: z.array(Address)` produces CRUD under
`/customers/:customerId/addresses`, with item routes ending in `/:addressId`. The same Address schema
can also appear under Supplier, or under multiple fields of one parent. Reusing a schema creates
separately owned values at each placement; each stored child inherits its containing root's
environment and lifetime. No child definition names a specific parent.

Controller scope identifies the containing root and complete child path. Child mutations atomically
modify and validate the complete containing document. Parent and child writes must enforce the same
managed-data rules, and the containing parent's output policy governs both response paths. Route
discovery supports unambiguous, finite containment paths and rejects ambiguous or recursive managed
child declarations. Ordinary nested Zod data does not acquire a managed lifecycle by nesting.

This removes the single-parent binding and public wrapper while retaining the explicit ownership
of contained data. It accepts parent-document growth, contention between child writes and more
expensive cross-parent queries. Resource naming and placement changes require explicit migration
when they affect existing data or routes.

This revises the public registration and root-only CRUD decisions in
[ADR 0030](0030-root-crud-and-ordinary-nested-data.md), and replaces the parent-specific declaration
from [ADR 0029](0029-parent-declared-contained-collections.md) with a reusable child marker.
Independent-resource reference storage is a separate decision; this ADR does not replace association
records or introduce stored reverse references.
