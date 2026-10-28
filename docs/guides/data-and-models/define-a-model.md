# How to define a model

Assumes you've finished [Tutorial 2: Accept tenants](../../tutorial/02-tenants.md). Use this guide when your app stores its own kind of record, such as a project, and you want it to have the same base fields as a tenant.

Your app needs `zod` as a dependency. Hedra's models are Zod schemas.

## Steps

1. Extend [`Resource`](../../reference/glossary.md) with your fields, and give each field a description and an example:

   ```ts
   import { z } from 'zod'

   import { Resource } from 'hedra'

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

   `constraints` in `.meta()` declares how records relate. `unique: true` says no two projects share a slug. `indexed: true` says the field is often searched. Hedra records these. It doesn't enforce them for you.

2. Derive the type from the schema, with the same name:

   ```ts
   export type Project = z.infer<typeof Project>
   ```

3. Derive the request variant from the model instead of writing a second schema:

   ```ts
   export const NewProject = Project.omit({ id: true, createdAt: true, updatedAt: true })
   export type NewProject = z.infer<typeof NewProject>
   ```

   Keep checks that compare two fields out of the schema, in a function the route calls. Zod's `.omit`, `.pick` and `.partial` throw on an object that has a `.refine` check.

## Verify

Check that the constraints you declared are ones Hedra knows:

```ts
import { RecordFieldConstraints } from 'hedra'

RecordFieldConstraints.parse(Project.shape.slug.meta()?.constraints)
```

A misspelt key fails with its name, such as `Unrecognized key: "uniqe"`.

Then parse a record:

```ts
Project.parse({
  id: crypto.randomUUID(),
  name: 'Website redesign',
  slug: 'website-redesign',
  createdAt: '2026-10-28T09:30:00.000Z',
  updatedAt: '2026-10-28T09:30:00.000Z',
})
```

It returns the record. A slug with a space, or a timestamp without `Z`, throws a `ZodError`.

Related: [Tenancy](../../concepts/tenancy.md), [Models reference](../../reference/models.md)
