# Collections and REST controllers

A collection defines an independent resource's model, storage name, endpoint and controller. Register it with Hedra to construct its controller and generate its HTTP routes. `new Collection('cars', CarModel)` uses the shared `BaseController` implementation; a Car-specific class is unnecessary.

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

Collection names start with a lower-case letter and contain lower-case letters, digits, underscores or hyphens. The name selects the literal SQLite table and root path: `cars.endpoint` is `/cars`. Registration adds GET/POST at `/cars` and GET/PATCH/DELETE at `/cars/:id`. The [model example](../examples/02-models.ts) registers a collection without inserting resources.

`EmbeddedResource` defines an owned value inside another resource, with the same managed metadata. Its containing schema can describe an array, dictionary or single value. Embedded values have nested routes and share their containing resource's lifetime; they do not have separate tables or root routes. Associations connect independently stored Resources. See [embedded resources and associations](web-layer.md) for definitions, paths and replacement rules.

## REST operations

`ControllerInterface` defines five asynchronous methods. Every call receives a Hono `Context` and a `Collection`; `BaseController` receives only the shared `Backend` at construction. One instance can serve different collections.

| Method | Behaviour | Result |
| --- | --- | --- |
| `create(context, collection, input)` | Insert attributes with a fresh UUID and current audit timestamps. | `JsonApiResponse` |
| `id(context, collection, id)` | Read one addressed resource. | `JsonApiResponse` |
| `list(context, collection, baseUrl, queryParams?)` | Read resources matching scalar equality filters. | `JsonApiListResponse` |
| `update(context, collection, input, id)` | Shallowly update one addressed resource. | `JsonApiResponse` |
| `delete(context, collection, id)` | Remove one addressed resource. | `void` |

For root and associated resources, `id` is a resource UUID. Generated embedded routes pass an array item's UUID, a dictionary key or a singleton field name. Custom controllers can use [resource scope](#resource-scope) to distinguish these cases without interpreting the positional argument or URL.

Single-resource responses contain flat attributes in `data` and a `links.self` URL. Ordinary/association/embedded-array lists contain an array in `data`; embedded-dictionary lists retain their keys in a dictionary. Lists use `baseUrl` for their self link. The exported Zod response schemas describe these flat envelopes. An absent resource on `id`, `update` or `delete` throws the existing 404 error. Generated routes choose the [HTTP statuses, headers and error handling](web-layer.md#requests-and-responses).

Create and direct item update ignore caller-supplied `id`, `createdAt` and `updatedAt`. Creation assigns the same current timestamp to both audit fields. Update uses the path selector, preserves the stored ID and creation time, and refreshes `updatedAt` inside the backend transaction. Unspecified attributes remain; supplied containers replace their attribute as a whole. Parent writes can retain embedded identities under the [container replacement rules](web-layer.md#replacing-embedded-values). Guards or storage failures abort the update. Any association involving an independent Resource blocks its deletion until explicitly unlinked.

The REST contract has no separate `get` or `replace` method. For context-free operations with null/boolean absence results, use the [programmatic resource operations](config-store.md#programmatic-operations).

## Input validation and filters

Generated routes derive pure input validators from the target model and pass the parsed data to the controller. Create applies required fields, normalisation and defaults; PATCH validates supplied fields without filling absent defaults. Other callers can derive a pure subset themselves:

```ts
const CreateCar = CarModel.omit({ id: true, createdAt: true, updatedAt: true }).strict()
const UpdateCar = CreateCar.partial()

const prepared = CreateCar.parse({ make: 'Toyota', model: 'Corolla', year: 2024 })
```

The controller accepts prepared JSON attributes and combines them with current state and managed metadata. Inside the storage transaction it validates the complete proposed resource, including cross-field model rules, before saving. A failed candidate returns 422 without writes; an output-projection failure is an internal 500. Embedded mutations validate the containing document too. The controller stays non-generic and obtains the validator from its per-call collection. Generic `ResourceOperations` remain model-independent; ConfigStore specialises [tenant writes](config-store.md#validation-and-scope). See the [validation decision](adr/0012-atomic-candidate-validation.md).

Model validators must be synchronous and describe the [stable stored representation](adr/0003-models-describe-stored-records.md). Parsed values must remain valid under the same model; transformations between incompatible request and stored representations belong in separate input/controller code. Models cannot replace server-managed identity or timestamps.

`QueryParams` supports only `filter`, a dictionary of top-level scalar equality criteria:

```ts
const result = await cars.controller.list(context, cars, 'https://example.test/cars', {
  filter: { make: 'Toyota', year: 2024 },
})
```

All criteria must match. String, number and boolean values remain distinct; null matches an explicit null field rather than an absent field. Field names are literal. Nested-object/array filters, undefined values and unsupported query options reject. Pagination, sorting and comparison operators are deferred.

For HTTP, supply one JSON `filter` query parameter, encoded with `URLSearchParams`. Generated routes reject undeclared/nonpublic filter fields; see [filter requests](web-layer.md#filters).

## Public output

Every returned resource passes through the public output policy: create, lookup, update and each list item. The default projection includes declared fields, omits `password` at each Resource/EmbeddedResource level and strips unknown fields, even when models allow extra properties. Private attributes remain stored. A failed output validator throws rather than falling back to raw data.

Set an explicit public validator in collection options to omit other sensitive attributes:

```ts
const Account = Resource.extend({ email: z.email(), password: z.string(), token: z.string() })
const accounts = new Collection('accounts', Account, {
  outputValidator: Account.omit({ password: true, token: true }).strip(),
})
```

The output validator defines the public fields. The default projection uses declared field validators without carrying object-level refinements that may depend on omitted private fields. Supply output-specific refinements explicitly when needed. Define public fields within ordinary nested objects explicitly too. Hidden embedded fields receive no exposing nested routes; exposed embedded output definitions must retain a compatible container and identity shape.

The internal embedded model module supplies schema definitions to routes and controllers; mutation,
complete-candidate validation and output projection keep their distinct policies. See the
[schema interpretation decision](adr/0027-embedded-schema-interpretation.md).

## Resource scope

`getResourceScope(context)` returns a data-only description of the address passed to a controller by a generated REST route. The exported `ResourceScope`, `EmbeddedScope`, `EmbeddedStep` and `AssociationScope` Zod schemas also provide their inferred types. Scope contains strings, arrays and plain objects; model/schema objects and traversal machinery stay internal.

| Property | Meaning |
| --- | --- |
| `collection` | Name of the independent collection whose controller receives the request. |
| `target` | A collection, resource UUID or embedded path, distinguished by `kind`. |
| `associations` | Independent-resource ancestors in URL order, excluding the addressed resource or embedded root. Empty when no association is traversed. |

The target has one of these shapes:

| Target | Shape | Generated requests |
| --- | --- | --- |
| Collection | `{ kind: 'collection' }` | Root/associated GET list and POST create. |
| Resource | `{ kind: 'resource', id }` | Root/associated GET item, PATCH and DELETE. |
| Embedded | `{ kind: 'embedded', rootId, steps }` | Nested embedded operations. `rootId` is the UUID of the independently stored containing resource; `steps` follows its embedded fields in URL order. |

Every embedded step names its `field` and container `kind`:

| Step | Selector |
| --- | --- |
| `{ field: 'notes', kind: 'array', id? }` | The item's UUID. Absent for list/create. |
| `{ field: 'namedNotes', kind: 'dictionary', key? }` | The decoded dictionary key. Absent for list; supplied by `?key=` for create or the path for item operations. |
| `{ field: 'summary', kind: 'single' }` | The field itself selects the singleton; no `id` or `key`. |

All steps before the final step select an item. Dictionary keys satisfy the model's key validator and the [URL key rules](web-layer.md#requests-and-responses). A dictionary item's stored UUID is separate from its key. Array create scope has no item UUID yet; the controller generates it during creation.

For `/projects/:projectId/labels/:labelId/namedNotes/release%20plan`, the labels controller receives:

```ts
{
  collection: 'labels',
  target: {
    kind: 'embedded',
    rootId: labelId,
    steps: [{ field: 'namedNotes', kind: 'dictionary', key: 'release plan' }],
  },
  associations: [{ collection: 'projects', id: projectId }],
}
```

Association chains retain every ancestor, outermost first. Embedded fields never become association ancestors. For the canonical `/labels/:labelId/namedNotes/release%20plan` route, `associations` is empty and the target stays the same.

For requests dispatched to resource controllers, the existing accessors are views of that same description:

| Accessor | Result |
| --- | --- |
| `getResourceScope(context)` | Complete `ResourceScope`; undefined when no generated REST handler supplied it. |
| `getEmbeddedScope(context)` | `{ rootId, steps }` for an embedded target; otherwise undefined. |
| `getAssociationScope(context)` | Nonempty ancestor array; otherwise undefined. |

Accessors return validated, detached values. Changing a returned value does not change the request's scope. Scope describes a requested address; it does not prove existence, ownership or permission. Delegating to `BaseController` retains ownership checks, complete association-chain checks, output filtering and transactional writes. Custom Hono routes and direct controller calls do not acquire scope automatically.

Association-unlink routes do not dispatch a resource controller, so `getResourceScope` and `getEmbeddedScope` return undefined. Their `getAssociationScope` result retains the ancestors preceding the link's source, including an empty array for a direct unlink. For example, unlinking `/projects/:projectId/labels/:labelId/associations/tags/:tagId` retains only the project ancestor; unlinking `/projects/:projectId/associations/labels/:labelId` returns `[]`.

The [custom-controller example](../examples/07-resource-scope.ts) reads scope before delegating to `BaseController` and exposes an extra method with its own inferred type. See the [scope decision](adr/0028-data-only-resource-scope.md) for the interface trade-off.

## Controller selection and lifecycle

The optional collection options object accepts a `controller` class implementing `ControllerInterface`, constructed with `(backend)`, an `outputValidator`, and declared `associations`. Custom controllers retain their own extra method types and remain independent of resource models. Generated handlers pass validated ancestry in their request context; controllers enforce scope and can delegate to BaseController's resource behaviour.

Custom controllers inspect the [resource scope](#resource-scope) through package exports; callers need no private context keys or internal imports.

Register collections and custom routes before handling the first request.

Accessing `collection.controller` before registration throws. Registration includes referenced association collections and their root routes. It rejects invalid definitions, ambiguous paths, duplicate names and reusing one collection instance across apps. A collection already registered in the same app may be referenced by a later definition; explicitly registering it again rejects. The built-in `tenants` name and internal tenant and association table names are reserved. See the [Tenant API](tenants.md). Failed registration leaves no partially bound controllers or routes.

`new Hedra()` lazily opens its default SQLite backend on first registration using `HEDRA_SQLITE_PATH`. An app can borrow a backend with `new Hedra({ backend })`. Closing the app ends access through its controllers, including saved references. It closes an owned backend; a borrowed backend stays available to other apps and configuration stores. Close is idempotent and registration after closure rejects. See [connection ownership](backends.md#connection-ownership) and [server configuration](configuration.md).

The [configuration datastore](config-store.md) is a separate dependency exposed through `app.configDatastore`. Supplying an application backend does not select configuration storage; inject both dependencies to share one connection.

## Run the REST example

From the repository root with Bun and the project's dependencies installed:

```sh
bun run examples/05-resource-controller.ts
```

The example registers Car once and exercises the generated routes through `app.request`. It uses in-memory SQLite and exits without opening a listener or leaving a database file. The [embedded-resource example](../examples/06-embedded-resources.ts) adds arrays, dictionaries, a single embedded field, shared associations and unlinking. Run `bun run examples/07-resource-scope.ts` from the same starting point to inspect generated addresses in a custom controller. Each example is independent and closes its in-memory storage.

## Updating existing callers

### Scope callers

The five REST method signatures and `getEmbeddedScope`/`getAssociationScope` function names are unchanged. `getResourceScope` adds the complete address for root, embedded and association requests. `AssociationScope` values and the ancestry accessors' absence behaviour are unchanged.

`EmbeddedStep` deliberately changes to data-only fields:

| Previous access | Current access |
| --- | --- |
| `step.field.name` | `step.field` |
| `step.field.kind` | `step.kind` |
| `step.selector` for an array | Narrow `step.kind === 'array'`, then read `step.id`. |
| `step.selector` for a dictionary | Narrow `step.kind === 'dictionary'`, then read `step.key`. |
| `step.field.model`, `.schema` or `.key` | Removed. Use your consuming application's declared model when you need its validation policy. |

The `EmbeddedField` package export is removed; it is internal traversal metadata. There is no schema-bearing compatibility representation. Persisted resources, generated routes, response envelopes and links require no migration. Update custom controllers and scope schema assertions together.

### Earlier controller callers

| Previous controller call | REST controller call |
| --- | --- |
| `create(input)` | `create(context, collection, input)` |
| `get(id)` | `id(context, collection, id)` |
| `list(filter)` | `list(context, collection, baseUrl, { filter })` |
| `update(id, input)` | `update(context, collection, input, id)` |
| `delete(id)` | `delete(context, collection, id)` |

Callers now receive response envelopes; missing resources throw and deletion resolves without a value. The old resource-parameterized `Controller<T>` export is removed. Existing databases are not migrated. This change adds no authentication or tenant isolation. See the [REST controller decision](adr/0009-rest-controller-interface.md).
