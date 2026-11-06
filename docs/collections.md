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

const cars = new Collection('cars', CarModel)
const hedra = new Hedra()
hedra.register(cars)
```

Collection names start with a lower-case letter and contain lower-case letters, digits, underscores or hyphens. The supplied name selects the literal SQLite table, without pluralisation or case conversion. `cars.endpoint` is `/cars`; it is metadata for the future Web layer. Registration adds no resource HTTP routes. Importing the example registers its collection without inserting resources.

## Controller operations

Inputs and results derive from the resource model. All operations return promises, and resource data is validated at runtime.

| Method | Behaviour | Result |
| --- | --- | --- |
| `create(input)` | Generate a fresh UUID, validate and insert a complete resource. | The parsed resource, including its ID, defaults and normalisation. |
| `get(id)` | Read and validate one resource. | The resource, or `null`. |
| `list(filter?)` | Read and validate every match in insertion order. Omit the filter or use `{}` for all resources. | An array, or `[]`. |
| `update(id, changes)` | Shallow-merge attributes into one resource and validate the complete result. | The updated resource, or `null`. |
| `replace(id, input)` | Replace one resource's attributes using the complete model. | The replacement resource, or `null`. |
| `delete(id)` | Remove one resource. | `true` when removed, otherwise `false`. |

IDs are immutable. Update and replacement retain the addressed ID; they do not insert missing resources. Replacement removes omitted optional attributes and applies model defaults. Update preserves unspecified attributes and replaces a supplied nested object or array as a whole. An empty changes object leaves the resource's attributes unchanged.

Update reads, validates and writes inside one backend transaction. Invalid data, a thrown refinement or a storage failure leaves the resource unchanged. The controller returns domain data and leaves HTTP response formatting to the future Web layer.

## Filters and validation

`list` supports equality filters on declared top-level scalar fields. Every supplied field must match. Values must be strings, finite numbers, booleans or null:

```ts
const toyotas = await cars.controller.list({ make: 'Toyota', year: 2024 })
```

Unknown fields, invalid field values, nested-object/array filters, undefined values and non-object filters reject before selection. Boolean, string and numeric values remain distinct. Null matches an explicit null field, rather than an absent optional field. Field names containing punctuation are matched literally.

Models provide synchronous refinements, defaults, normalisation and unknown-property handling. Async controller methods do not enable asynchronous Zod refinements. Give each schema and its inferred TypeScript type the same name.

Resources must be JSON-compatible objects. Omitted optional attributes are supported; explicit undefined values, non-finite numbers, bigint, special objects and cycles are rejected before persistence. Parsing a stored resource again must produce an equivalent resource. Stable defaults and string trimming fit this contract; incompatible or continually changing transformations do not.

Reads validate stored resources against the current model. Changing a model to reject existing data can make reads fail. There is no automatic repair, migration, pagination, sorting option or comparison query language.

## Custom controllers

The third collection argument selects a custom controller class. Its constructor follows the generic controller's `(name, model, backend)` contract. The concrete type is preserved, including additional methods. Replace the default collection definition before registration:

```ts
class CarController extends Controller<typeof CarModel> {
  /** Changes the year through the normal resource validation. */
  async setYear(id: string, year: number) {
    return this.update(id, { year })
  }
}

const cars = new Collection('cars', CarModel, CarController)
hedra.register(cars)
```

The generic `Controller` can also be constructed directly with a name, model and backend for use without an HTTP server. See the [controller example](../examples/05-resource-controller.ts), which checks custom-controller registration, generated IDs and updates using an in-memory database.

## Registration and lifecycle

Accessing `collection.controller` before registration throws. Registration rejects invalid definitions, duplicate names and reusing one collection instance across apps. Construct a fresh collection from the schema for a new app. A failed registration does not leave a partially bound controller.

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
