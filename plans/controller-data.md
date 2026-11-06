# Controllers accept resource data without resource models

Status: correction and test scope approved in chat. Implementation follows the contract below.

## Corrected responsibility split

The future Web layer uses a subset of a resource model as a pure validator. Its parsed output is plain data. Controllers accept typed resource data and explicitly enforce sensitive-field rules; they do not require or parse a resource model. Generic storage retains its JSON and key-integrity validation.

TypeScript checks controller inputs and results at compile time. It does not validate arbitrary incoming JSON at runtime. Controller runtime guards therefore remain explicit for server-owned IDs and structural storage invariants. Resource-specific controllers can add their own sensitive-field or business-rule checks without supplying a schema to the controller base class.

## Public contract

- Change `Controller<Schema extends z.ZodObject>` to a controller parameterized by the plain resource data type, with common resource metadata represented by its existing inferred TypeScript type.
- The constructor becomes `(name, backend)`. Remove the resource model argument, stored model property, schema generic and full-resource parsing from the controller.
- Preserve async `create`, `get`, `list`, `update`, `replace`, and `delete`, with their existing missing-resource results and single-ID mutation semantics.
- Derive create/replacement attribute types and partial-update types from the plain resource data shape. Keep required fields and catchall types, and forbid inbound `id` at compile time. The data type describes already prepared values; defaults and transformations are applied by the producer's validator, not the controller.
- Preserve runtime rejection of supplied IDs in mutation payloads, generation of a fresh UUID by the default controller, immutable IDs, generic object/JSON safeguards, and scalar-filter/ID guards as appropriate. These checks must not require a Car/Tenant schema. Reuse shared metadata constraints rather than duplicating ID rules.
- Controller listing retains scalar equality filters. Declared-field typing is static; without a model, the controller does not perform model-specific runtime field checks.
- Keep model definitions on `Collection`. Its factory supplies only the table name and backend to the selected controller; the model supplies the inferred resource data type at compile time. Custom controllers inherit the same two-argument construction contract.
- Update `ConfigStore.tenants` to `Controller<Tenant>` as a plain data type, and update custom examples to extend the controller with a plain inferred data type rather than `typeof` a schema.

Controllers no longer apply model defaults, trimming, refinements or stored-resource validation. A caller needing those behaviours runs the relevant pure validator before calling the controller. Configuration examples will validate tenant-create data explicitly outside the controller. Do not move a model onto another controller property or introduce a validator callback that recreates that dependency.

This correction deliberately changes model-parsing behaviour while retaining resource-operation, identity, transaction and ownership contracts. The future Web layer is still deferred; this increment adds no routes or general validation framework.

## Approved test scope

Use the public controller, collection-registration and configuration interfaces, with the existing SQLite backend. Do not inspect private properties or spy on schema parser calls.

| Named behaviour | Evidence at the public seam |
| --- | --- |
| `controllers accept plain resource types without a model argument` | Construct a standalone typed controller with a name and backend; perform the resource lifecycle. Compiler checks cover required attributes, model-specific result fields, loose/catchall data, and typed custom methods. Old schema-argument construction is no longer accepted. |
| `caller validation prepares data before controller operations` | A model-derived input subset supplies normalisation/defaults, then controller creation persists and returns that prepared data. A direct typed call preserves its supplied attributes rather than reapplying model parsing. |
| `controllers reject caller-owned changes to server resource IDs` | Retain compile-time and runtime rejection of IDs on create/update/replace, fresh UUID allocation, malformed-ID rejection and immutable storage keys. |
| `resource operations remain atomic and scoped to one ID` | Retain CRUD, missing-resource, shallow update/full replacement, backend error, JSON safety and per-table isolation coverage. Remove expectations that the controller runs resource-model refinements or normalisers. Explicit controller guard failures must still leave storage unchanged. |
| `collection registration and config storage reuse model-independent controllers` | Base/custom construction, custom method typing, reserved tenant table, standalone ConfigStore operation and saved-controller closure continue working with shared-backend ownership. |

Update existing examples and docs to distinguish compile-time controller typing, runtime sensitive-field guards and caller-owned pure validation. Retain generic backend regressions unchanged. Do not add tests that merely repeat Zod's own validators; test validator-to-controller composition and public application behaviour instead.

## Files and validation

Production scope is the controller, collection/controller construction types, configuration-store typing, and shared metadata helpers only if needed for the existing sensitive-field checks. The SQLite backend contract, physical table layout and connection ownership remain unchanged.

Revise relevant controller/registration/configuration tests and examples. Run `bun run check` and the documented examples, then obtain an independent read-only review. Use the existing global coder and reviewer roles. Documentation stays in a separate docs worktree during implementation. Merge to main only with the user's approval after review.

ADR 0008 supersedes ADR 0007's placement of model validation in controllers while retaining its collection, storage and ownership decisions. No legacy migration, HTTP implementation, new backend, new dependency, or configurable sensitive-field framework is included.
