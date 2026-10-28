# How to define a model

Assumes you've finished [Tutorial 3: Add environments](../../tutorial/03-environments.md). [Tenancy](../../concepts/tenancy.md) explains why models leave checks across fields to functions. Use this guide when your app stores its own kind of record, such as a project, and you want it to have the same base fields as a tenant.

Hedra isn't published as a package yet, so this guide works inside the repository, like the tutorial. Put each snippet in one file in the repository root, such as `project.ts`, in the order shown. The code uses Zod 4, which the repository already installs, and its `.describe()`, `.meta()`, `.refine` and `z.infer`. The [Zod docs](https://zod.dev) cover them.

## Steps

1. Extend [`Resource`](../../reference/models.md#resource) with your fields. Give each field a description and an example, as Hedra's own models do. Zod keeps them on the schema, and `z.toJSONSchema` includes them in the JSON Schema it produces:

   ```ts
   import { z } from 'zod'

   import { Resource } from '#hedra.ts'

   export const Project = Resource.extend({
     slug: z.string()
       .trim()
       .regex(/^[a-z0-9-]+$/)
       .describe('The URL-safe identifier of the project')
       .meta({
         example: 'website-redesign',
         constraints: { unique: true },
       }),
   })
   ```

   `constraints` in `.meta()` declares a rule about records: here, that no two projects share a slug. Nothing in Hedra enforces it yet, so your route checks it, as chapter 2's route checks `tenants.has`. The [constraint schemas](../../reference/models.md#constraint-schemas) list every constraint.

2. Derive the type from the schema, with the same name:

   ```ts
   export type Project = z.infer<typeof Project>
   ```

3. Derive the schema for request bodies from the model, as chapter 2 derived `NewTenant`. Don't add `.refine` to `Project` first: Zod's `.omit` throws on an object schema that has one. Put a check that compares two fields in a function your route calls.

   ```ts
   export const NewProject = Project.omit({ id: true, createdAt: true, updatedAt: true })
   export type NewProject = z.infer<typeof NewProject>
   ```

## Verify

Add these lines to the end of `project.ts`. `RecordFieldConstraints` is the schema for a field's constraints, so parsing with it catches a misspelt key:

```ts
console.log(RecordFieldConstraints.parse(Project.shape.slug.meta()?.constraints))

console.log(
  Project.parse({
    id: crypto.randomUUID(),
    name: 'Website redesign',
    slug: 'website-redesign',
    createdAt: '2026-10-28T09:30:00.000Z',
    updatedAt: '2026-10-28T09:30:00.000Z',
  }),
)
```

Run it:

```sh
bun run project.ts
```

Bun prints the constraints, then the project. Your `id` differs:

```text
{
  unique: true,
}
{
  id: "8d3f0b2a-6c1e-4a7b-9e2d-5f4a3b2c1d0e",
  name: "Website redesign",
  createdAt: "2026-10-28T09:30:00.000Z",
  updatedAt: "2026-10-28T09:30:00.000Z",
  slug: "website-redesign",
}
```

Delete `project.ts` when you're done.

Next: [Models reference](../../reference/models.md)
