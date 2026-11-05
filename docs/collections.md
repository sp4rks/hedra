# Collection methods

A model is a Zod object schema defining a record's fields and validation. A collection gives those records a name and synchronous CRUD methods backed by SQLite. Register it with a Hedra app before calling its methods.

The [model example](../examples/02-models.ts) exports a `CarModel` schema and its inferred TypeScript type, a `cars` collection, and the default Hedra app:

```ts
const cars = new Collection('cars', CarModel)
const hedra = new Hedra()
hedra.register(cars)
```

Importing the example registers its collection without inserting any records. Collection names start with a lower-case letter and contain only lower-case letters, digits, underscores or hyphens. Names are used as supplied, without pluralisation or case conversion.

This feature provides collection methods for one tenant. Record IDs, generated metadata, HTTP collection routes, authentication and tenant isolation come with later controller work.

## Methods and results

Inputs and return types derive from the collection's Zod model. All inputs are also validated at runtime.

| Method | Behaviour | Result |
| --- | --- | --- |
| `post(record)` | Validate and insert one full record. | The parsed record, including model defaults and normalisation. |
| `get(filter?)` | Read every matching record in insertion order. Omit the filter or use `{}` to read the entire collection. | An array, or `[]` when nothing matches. |
| `put(filter, record)` | Replace every match with the full validated record. Omitted fields follow the model's defaults and optionality. | Number of records replaced, or `0`. |
| `patch(filter, changes)` | Merge supplied top-level fields into every match and validate each complete result. | Number of matching records updated, or `0`. |
| `delete(filter)` | Delete every matching record. | Number of records deleted, or `0`. |

PUT replaces existing records and returns `0` when none match. Duplicate records are permitted. No operation adds an ID or timestamps.

PATCH replaces a supplied nested object or array as a whole. It leaves fields absent from the patch unchanged, including fields with model defaults. Null is a value validated by the model. An empty patch object leaves records unchanged and reports the number of matches.

Each PUT or PATCH call is atomic: all matching records are validated and written together. If any result fails validation or storage fails, none of that call's changes persist. DELETE is also atomic.

## Filters

A filter matches declared top-level model fields by equality. Every supplied field must match. Values must be strings, finite numbers, booleans or null.

```ts
cars.get({ make: 'Toyota', year: 2024 })
cars.patch({ make: 'Toyota' }, { year: 2025 })
```

The second call updates **every Toyota**. PUT, PATCH and DELETE require a nonempty filter. Unknown field names, nested-object or array values, undefined values and non-object filters throw errors before selection.

Boolean, string and numeric values remain distinct: `true`, `'1'` and `1` do not match each other. Null matches an explicit null field and does not match an absent optional field. A field name containing punctuation is matched literally.

GET returns all matches. There is no sorting option, pagination or comparison-operator query language in this version.

## Models and validation

Use a synchronous Zod object schema and infer its TypeScript type from the schema. Give the schema and type the same name, as in `CarModel` in the example. The model supplies required fields, defaults, refinements, normalisation and unknown-field handling.

Stored records must be JSON-compatible objects, including nested objects and arrays. Omitted optional fields are supported. Explicit undefined values, non-finite numbers, bigint, special objects and cycles are rejected before persistence.

Parsing a stored record through its model again must produce an equivalent record. Defaults and string trimming fit this contract. A transformation that accepts one type and returns an incompatible type, or changes a value on every parse, is rejected. Separate controller input schemas will handle conversions between incompatible representations later.

GET validates matched stored records through the current model. PATCH validates the stored records and the complete merged results, preserving cross-field refinements. Changing a model to reject existing data can make reads fail; there is no automatic migration or repair.

Validation, JSON-contract, lifecycle and native storage failures throw errors. Zod validation errors retain their field details. Applications and future controllers decide how to handle those errors; collection methods do not translate them into HTTP responses.

## Database configuration and lifecycle

Hedra owns one SQLite connection shared by its registered collections. It opens the database on the first registration. Constructing an app alone opens no database. Collections have no individual storage configuration.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `HEDRA_SQLITE_PATH` | `.runtime/hedra.sqlite` | Database file, relative to the application's working directory unless absolute. Use `:memory:` for a temporary in-memory database. |

[Configuration](configuration.md) trims explicit values and uses the default for blank values. Explicit environment values win over an environment file. Registration creates the database's parent directory when necessary. An invalid or unwritable location throws an error.

For a container, set a path such as `/data/hedra.sqlite` and mount a persistent volume at `/data`. Persist the containing directory so SQLite's accompanying files remain with the database. Different collections share the file and keep their records separate.

Call `hedra.close()` to release the connection when collection work is finished. Closing does not delete data, and repeated close calls are harmless. Close is terminal for that app's collections: their methods and further registrations throw afterwards. A new app can reopen the same file.

Methods throw before registration. Registration rejects duplicate collection names and attaching one collection instance to multiple apps. Reuse the schema to construct a fresh collection for a new app.

## Run the model example's CRUD methods

From the repository root, with Bun and the project's dependencies installed, run the following command. It imports the actual example and uses an in-memory database, so it leaves existing collection data untouched.

```sh
HEDRA_SQLITE_PATH=:memory: HEDRA_SERVER_SILENT_STARTUP=true HEDRA_SERVER_LOG_LEVEL=silent bun run - <<'TS'
import assert from 'node:assert/strict'

import hedra, { cars } from './examples/02-models.ts'

try {
  assert.deepEqual(cars.get(), [])

  const car = cars.post({ make: 'Toyota', model: 'Corolla', year: 2024 })
  assert.deepEqual(car, { make: 'Toyota', model: 'Corolla', year: 2024 })
  assert.deepEqual(cars.get({ make: 'Toyota' }), [
    { make: 'Toyota', model: 'Corolla', year: 2024 },
  ])

  assert.equal(cars.put({ make: 'Toyota' }, { make: 'Toyota', model: 'Yaris', year: 2025 }), 1)
  assert.deepEqual(cars.get(), [{ make: 'Toyota', model: 'Yaris', year: 2025 }])

  assert.equal(cars.patch({ model: 'Yaris' }, { year: 2026 }), 1)
  assert.deepEqual(cars.get(), [{ make: 'Toyota', model: 'Yaris', year: 2026 }])

  assert.equal(cars.delete({ make: 'Toyota' }), 1)
  assert.deepEqual(cars.get(), [])
} finally {
  hedra.close()
}
TS
```

The command should exit with status `0` and no output. A failed assertion or method error exits with an error. Running this script calls collection methods directly; it starts no HTTP server.
