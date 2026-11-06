# Collections and REST controllers

A collection defines a resource model, storage name, endpoint metadata and controller. Register it with Hedra to construct its controller. `new Collection('cars', CarModel)` uses the shared `BaseController` implementation; a Car-specific class is unnecessary.

```ts
import { z } from 'zod'

import { Collection, Hedra, Resource } from '#hedra.ts'

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

The common `Resource` schema defines UUID `id` and ISO `createdAt`/`updatedAt` timestamps. Other attributes belong to the resource model. Models supply pure validators and inferred data types; controllers are independent types with no resource or schema type parameter.

Collection names start with a lower-case letter and contain lower-case letters, digits, underscores or hyphens. The name selects the literal SQLite table. `cars.endpoint` is `/cars`; registration adds no resource HTTP routes. The [model example](../examples/02-models.ts) registers a collection without inserting resources.

## REST operations

`ControllerInterface` defines five asynchronous methods. Every call receives a Hono `Context` and a `Collection`; `BaseController` receives only the shared `Backend` at construction. One instance can serve different collections.

| Method | Behaviour | Result |
| --- | --- | --- |
| `create(context, collection, input)` | Insert attributes with a fresh UUID and current audit timestamps. | `JsonApiResponse` |
| `id(context, collection, id)` | Read one resource by UUID. | `JsonApiResponse` |
| `list(context, collection, baseUrl, queryParams?)` | Read resources matching scalar equality filters. | `JsonApiListResponse` |
| `update(context, collection, input, id)` | Shallowly update one resource by UUID. | `JsonApiResponse` |
| `delete(context, collection, id)` | Remove one resource by UUID. | `void` |

Single-resource responses contain flat attributes in `data` and a `links.self` URL. Lists contain an array in `data` and use `baseUrl` for their self link. The exported Zod response schemas describe these Multi21-style envelopes. An absent resource on `id`, `update` or `delete` throws the existing 404 error. Routes choose HTTP status codes, headers and error handling.

Create and update ignore caller-supplied `id`, `createdAt` and `updatedAt`. Creation assigns the same current timestamp to both audit fields. Update uses the explicit path ID, preserves the stored ID and creation time, and refreshes `updatedAt` inside the backend transaction. Unspecified attributes remain; a supplied nested object or array replaces that attribute as a whole. Guards or storage failures abort the update.

The REST contract has no separate `get` or `replace` method. For context-free operations with null/boolean absence results, use the [programmatic resource operations](config-store.md#programmatic-operations).

## Input validation and filters

The route or caller validates domain input before invoking the controller. Derive a pure subset from the model, omitting server-owned metadata:

```ts
const CreateCar = CarModel.omit({ id: true, createdAt: true, updatedAt: true }).strict()
const UpdateCar = CreateCar.partial()

hedra.post('/cars', async (context) => {
  const input = CreateCar.parse(await context.req.json())

  return context.json(await cars.controller.create(context, cars, input), 201)
})
```

Defaults, normalisation and domain refinements run in the pure validator. The controller accepts plain JSON attributes and independently handles managed fields and generic JSON integrity. It does not repeat domain input parsing. Explicit undefined values, non-finite numbers, bigint, special objects and cycles reject before persistence.

`QueryParams` supports only `filter`, a dictionary of top-level scalar equality criteria:

```ts
const result = await cars.controller.list(context, cars, 'https://example.test/cars', {
  filter: { make: 'Toyota', year: 2024 },
})
```

All criteria must match. String, number and boolean values remain distinct; null matches an explicit null field rather than an absent field. Field names are literal. Nested-object/array filters, undefined values and unsupported query options reject. Pagination, sorting and comparison operators are deferred.

## Public output

Every returned resource passes through `collection.outputValidator`: create, lookup, update and each list item. The default projection includes the model's declared fields, omits a top-level `password` field and strips unknown fields, even when the resource model allows extra properties. Private attributes remain stored. A failed output validator throws rather than falling back to raw data.

Set an explicit public validator in collection options to omit other sensitive attributes:

```ts
const Account = Resource.extend({ email: z.email(), password: z.string(), token: z.string() })
const accounts = new Collection('accounts', Account, {
  outputValidator: Account.omit({ password: true, token: true }).strip(),
})
```

The output validator defines the public fields. The default projection uses declared field validators without carrying object-level refinements that may depend on omitted private fields. Supply output-specific refinements explicitly when needed. Identify nested secrets in your output schema too.

## Controller selection and lifecycle

The optional collection options object accepts a `controller` class implementing `ControllerInterface`, constructed with `(backend)`, and/or an `outputValidator`. Custom controllers retain their own extra method types and remain independent of resource models.

Accessing `collection.controller` before registration throws. Registration rejects invalid definitions, duplicate names and reusing one collection instance across apps. The internal `hedra_config_tenants` table name is reserved for configuration. Failed registration leaves no partially bound controller.

`new Hedra()` lazily opens its default SQLite backend on first registration using `HEDRA_SQLITE_PATH`. An app can borrow a backend with `new Hedra({ backend })`. Closing the app ends access through its controllers, including saved references. It closes an owned backend; a borrowed backend stays available to other apps and configuration stores. Close is idempotent and registration after closure rejects. See [connection ownership](backends.md#connection-ownership) and [server configuration](configuration.md).

## Run the REST example

From the repository root with Bun and the project's dependencies installed:

```sh
bun run examples/05-resource-controller.ts
```

The example derives Car input validators, registers the generic controller and explicitly wires five routes. It exercises them through `app.request`, uses in-memory SQLite and exits successfully without opening a listener or leaving a database file. Route generation remains future Web-layer work.

## Updating existing callers

| Previous controller call | REST controller call |
| --- | --- |
| `create(input)` | `create(context, collection, input)` |
| `get(id)` | `id(context, collection, id)` |
| `list(filter)` | `list(context, collection, baseUrl, { filter })` |
| `update(id, input)` | `update(context, collection, input, id)` |
| `delete(id)` | `delete(context, collection, id)` |

Callers now receive response envelopes; missing resources throw and deletion resolves without a value. The old resource-parameterized `Controller<T>` export is removed. Existing databases are not migrated. This change adds no authentication or tenant isolation. See the [REST controller decision](adr/0009-rest-controller-interface.md).
