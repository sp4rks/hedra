# Collections and resource controllers

A collection defines a resource's model, storage name, endpoint metadata and controller. Register it with Hedra to construct its controller, then await operations through `collection.controller`.

Resource models extend the shared `Resource` Zod schema, which defines the UUID `id`. The default controller generates a fresh ID on creation. Create, update and replacement inputs must omit `id`; supplying one, even the current ID, rejects.

The [model example](../examples/02-models.ts) exports a `CarModel` schema and its inferred TypeScript type, a `cars` collection, and the default Hedra app:

```ts
const CarModel = Resource.extend({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})

type CarModel = z.infer<typeof CarModel>

const cars = new Collection('cars', CarModel)
const hedra = new Hedra()
hedra.register(cars)
```

Collection names start with a lower-case letter and contain lower-case letters, digits, underscores or hyphens. The supplied name selects the literal SQLite table, without pluralisation or case conversion. `cars.endpoint` is `/cars`; it is metadata for the future Web layer. Registration adds no resource HTTP routes. Importing the example registers its collection without inserting resources.

## Controller operations

Controller inputs and results use plain resource data types. A collection infers that type from its model's output; the controller receives only a name and backend. All operations return promises. TypeScript checks resource attributes at compile time; runtime checks protect server-owned IDs and generic object/JSON integrity.

| Method | Behaviour | Result |
| --- | --- | --- |
| `create(input)` | Generate a fresh UUID and insert the supplied resource attributes. | The resource, including its generated ID. |
| `get(id)` | Read one resource with its ID checks. | The resource, or `null`. |
| `list(filter?)` | Read every match in insertion order. Omit the filter or use `{}` for all resources. | An array, or `[]`. |
| `update(id, changes)` | Shallow-merge attributes into one resource, preserving its ID. | The updated resource, or `null`. |
| `replace(id, input)` | Replace one resource's attributes, preserving its ID. | The replacement resource, or `null`. |
| `delete(id)` | Remove one resource. | `true` when removed, otherwise `false`. |

IDs are immutable. Update and replacement retain the addressed ID; they do not insert missing resources. Replacement removes omitted optional attributes. Update preserves unspecified attributes and replaces a supplied nested object or array as a whole. An empty changes object leaves the resource's attributes unchanged.

Update reads, applies its guards and writes inside one backend transaction. A failed guard, unsupported JSON value or storage failure leaves the resource unchanged. Custom controllers can enforce resource-specific sensitive-field and business rules explicitly. The controller returns domain data and leaves HTTP response formatting to the future Web layer.

## Filters and validation

`list` supports equality filters on top-level scalar fields. TypeScript restricts the declared fields and their value types. Runtime checks require strings, finite numbers, booleans or null; every supplied field must match:

```ts
const toyotas = await cars.controller.list({ make: 'Toyota', year: 2024 })
```

Nested-object/array filters, undefined values and non-object filters reject before selection. Boolean, string and numeric values remain distinct. Null matches an explicit null field, rather than an absent optional field. Field names containing punctuation are matched literally. A controller has no model for checking resource-specific query rules at runtime; the future request validator owns those rules.

Models are pure validation and type sources. Their refinements, defaults, normalisation and unknown-property handling run when a caller invokes the validator. Give each schema and its inferred TypeScript type the same name. The future Web layer will derive public-input validators from a resource model; programmatic callers can use the same composition now:

```ts
const CreateCar = CarModel.omit({ id: true }).strict()
const input = CreateCar.parse({ make: 'Toyota', model: 'Corolla', year: 2024 })
const car = await cars.controller.create(input)
```

Controllers accept the prepared output type, rather than the validator's raw input type. If validation supplies a default, call the validator first or provide that field explicitly. The controller preserves supplied attributes and does not reapply model parsing. See the [tenant example](../examples/04-config-store.ts) for caller-side trimming and validation.

Resources must be JSON-compatible objects. Omitted optional attributes are supported; explicit undefined values, non-finite numbers, bigint, special objects and cycles are rejected before persistence.

Controllers do not parse stored resources through a resource model. Callers that need model validation on reads apply their validator explicitly. There is no automatic repair, migration, pagination, sorting option or comparison query language.

## Controller selection

`new Collection('cars', CarModel)` automatically uses the generic controller. A Car-specific controller class is unnecessary. The model stays on the collection and supplies the inferred plain data type; it is not passed to the controller.

The same generic implementation can be constructed directly as `new Controller<CarModel>('cars', backend)` for use without a collection or HTTP server. `CarModel` in that type argument is the inferred data type, rather than `typeof CarModel`, the schema type. See the [standalone generic controller example](../examples/05-resource-controller.ts).

If resource-specific behaviour is needed, the third collection argument can select a custom controller class. It inherits the `(name, backend)` construction contract and retains its extra method types.

## Registration and lifecycle

Accessing `collection.controller` before registration throws. Registration rejects invalid definitions, duplicate names and reusing one collection instance across apps. The internal `hedra_config_tenants` table name is reserved for configuration and cannot be registered as an application collection. Construct a fresh collection from the schema for a new app. A failed registration does not leave a partially bound controller.

By default, Hedra opens its owned SQLite backend on the first registration, using `HEDRA_SQLITE_PATH`. See [server configuration](configuration.md) for resolution and defaults, and [backend storage](backends.md#sqlite-storage) for file layout and persistence. Construction of an app alone opens no default database.

An application can instead pass `new Hedra({ backend })` to borrow an existing backend. `hedra.close()` ends all its registered controllers' access, including saved references. It closes its owned backend, while a borrowed backend remains available to other apps and configuration stores. Close is idempotent; registration after closure rejects. The creator of a shared backend closes it after its users finish.

## Run the model example

From the repository root with Bun and the project's dependencies installed, run:

```sh
HEDRA_SQLITE_PATH=:memory: HEDRA_SERVER_SILENT_STARTUP=true HEDRA_SERVER_LOG_LEVEL=silent bun run - <<'TS'
import assert from 'node:assert/strict'

import hedra, { cars } from './examples/02-models.ts'

try {
  const controller = cars.controller
  assert.deepEqual(await controller.list(), [])

  const car = await controller.create({ make: 'Toyota', model: 'Corolla', year: 2024 })
  assert.deepEqual(await controller.get(car.id), car)
  assert.deepEqual(await controller.list({ make: 'Toyota' }), [car])

  const replacement = { id: car.id, make: 'Toyota', model: 'Yaris', year: 2025 }
  assert.deepEqual(await controller.replace(car.id, { make: 'Toyota', model: 'Yaris', year: 2025 }), replacement)
  assert.deepEqual(await controller.update(car.id, { year: 2026 }), { ...replacement, year: 2026 })

  assert.equal(await controller.delete(car.id), true)
  assert.equal(await controller.get(car.id), null)
  assert.deepEqual(await controller.list(), [])
} finally {
  hedra.close()
}
TS
```

The command uses in-memory storage and should exit with status `0` and no output. Importing and calling the example this way starts no HTTP server.

## Updating existing callers

| Previous call | Current call |
| --- | --- |
| `cars.post(input)` | `await cars.controller.create(input)` |
| `cars.get(filter)` | `await cars.controller.list(filter)` |
| `cars.put(filter, input)` | `await cars.controller.replace(id, input)` |
| `cars.patch(filter, changes)` | `await cars.controller.update(id, changes)` |
| `cars.delete(filter)` | `await cars.controller.delete(id)` |

Mutations now address one ID instead of every filter match. Old synchronous methods and bulk mutations are removed. Existing resources in the previous shared `hedra_records` table are not imported. This change adds no authentication or tenant isolation.
