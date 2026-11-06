# Independent resource-operation data types

Remove the `Resource` constraint from `ResourceOperations<T>` and its mapped input/filter helpers. The class is an operations helper; its generic parameter describes caller data and does not have to declare Resource's metadata fields. Remove the unused Resource type import. Preserve existing method names, argument order, return types, metadata generation/protection, JSON guards, filters, atomic mutations and absence behaviour.

This is a type correction with no storage or runtime behaviour change. ConfigStore remains typed by Tenant, and existing resource-shaped callers remain valid. Update the programmatic-operations reference to describe the unconstrained data type. No new backend changes, metadata abstraction, migrations or controller changes are included.

## Verification owned by the lead

- At the exported TypeScript interface, instantiate operations with a Zod-inferred plain data type that lacks Resource metadata. The compiler must reject this before the fix and accept it afterward, while retaining attribute/filter type checks.
- Exercise the plain-data caller through ResourceOperations with real in-memory SQLite and confirm create/read/update/filter operations still work; inspect generated metadata through the public Resource schema where needed.
- Retain the existing programmatic operations, ConfigStore and SQLite integrity coverage. Run `bun run check`, then obtain independent read-only review of the fixed commit range.

The lead owns test design and acceptance. Merge to main requires the user's approval.
