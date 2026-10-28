# How to define a model

Assumes you've finished [Tutorial 2: Accept tenants](../../tutorial/02-tenants.md). Use this guide when your app stores its own kind of record, such as a project, and you want it to have the same base fields as a tenant.

The code uses Zod 4, which the repository already installs. It uses `.describe()`, `.meta()` and `z.infer`, which the [Zod docs](https://zod.dev) cover. Put each snippet in one file in the repository root, such as `project.ts`, in the order shown.

## Steps

1. Extend [`Resource`](../../reference/models.md#resource) with your fields. Give each field a description and an example. They stay on the schema, where `z.toJSONSchema` can read them.

   ```ts
   import { z } from 'zod'

   import { RecordFieldConstraints, Resource } from '#hedra.ts'

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

   `constraints: { unique: true }` declares that no two projects share a slug. The [constraint schemas](../../reference/models.md#constraint-schemas) list every constraint.

2. Derive the type from the schema, with the same name:

   ```ts
   export type Project = z.infer<typeof Project>
   ```

3. Don't add `.refine` to the model if you need variants. Zod's `.omit`, `.pick` and `.partial` throw on an object schema that has one. Put a check that compares two fields in a function your route calls, as the tutorial does with `tenantDomainValidator`.

4. Derive the variant for request bodies from the model, as chapter 2 derived `NewTenant`:

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
  slug: "website-redesign",
  createdAt: "2026-10-28T09:30:00.000Z",
  updatedAt: "2026-10-28T09:30:00.000Z",
}
```

A misspelt constraint, such as `uniqe`, throws with `Unrecognized key: "uniqe"`. A slug with a space, or a timestamp without `Z`, throws a `ZodError`. Delete `project.ts` when you're done.

Next: [Models reference](../../reference/models.md)
