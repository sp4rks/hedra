# Controller-owned public output

Status: design and public test seams accepted by the lead for the user's requested implementation.
Merge into main requires the user's approval after verification and independent review.

## Behaviour and scope

Resource models describe stored data. Controllers own response projection. Replace recursive public-schema
inference with the shallow M21 default while retaining Hedra's existing enforcement and transaction safety.

- The default output validator contains the model's declared top-level fields except `password`.
- Build a fresh stripping Zod object from those fields. Do not copy root object refinements or catchall/loose
  behaviour: refinements may require the omitted password, and undeclared root fields stay private.
- Reuse each remaining field schema unchanged. Nested objects, arrays, tuples, dictionaries, unions,
  intersections, lazy schemas, wrappers and transformations follow their ordinary Zod semantics.
- Do not infer nested privacy, classify dynamic output alternatives, or reject schema compositions merely
  because their public shape is ambiguous. Applications select their nested public fields explicitly.
- An explicit Collection.outputValidator remains authoritative, including an explicitly exposed password.
- BaseController continues projecting create, id, every list item and update. Preserve clone isolation,
  JSON validation, declared root key selection, output identity checks and no raw-data fallback.
- Keep complete-candidate validation and projection within write transactions. Output failures roll back
  create/update. Keep existing exactly-once update projection behaviour.
- Custom controllers remain responsible for their response policy; delegation to BaseController applies
  the selected collection output validator. Add no controller hooks, resource kinds or SecretResource.

This deliberately supersedes ADR 0030's recursive output-privacy and ambiguous-composition policy.
Nested passwords and undeclared nested fields can now be returned if their field schemas allow them.
Existing consumers must select explicit nested output schemas or enforce policy in their controllers
before adopting the change. Stored records and associations need no migration or rewrite.

## Interface and structure

No route, request, controller method, Collection option or package export changes.

```text
src/models/resource.ts          Resource/reference/association schemas and UUID model assertion only.
src/controllers/projection.ts   Existing projection safeguards plus a small defaultOutputValidator helper.
src/models/collection.ts        Initialises outputValidator through the controller-owned shallow default.
tests/controllers/rest.test.ts  Existing controller-output enforcement and failure-path coverage.
tests/server/no-nested-crud.test.ts
                               HTTP coverage of ordinary nested data and explicit output policy.
docs/collections.md             Authoritative output defaults, application responsibilities and migration.
docs/web-layer.md               Links to the revised public-output policy.
docs/adr/0031-controller-owned-public-output.md
                               Decision superseding the relevant output clauses of ADR 0030.
examples/08-public-output.ts    Runnable public-output example with an explicit nested schema.
```

Delete outputKind, publicSchema and publicModel from resource.ts. Export defaultOutputValidator only from
the internal projection module; Collection uses it because filters need the selected public keys before
controller dispatch. Its implementation needs one top-level field selection and z.object, with no schema
definition cloning or recursive traversal. Reuse project unchanged unless a confirmed wiring issue requires
a minimal fix. No new dependency or compatibility alias.

## Test design

Use public exports from src/hedra.ts, controller methods through HTTP contexts, app.request and real
in-memory SQLite. No tests of private helper functions, Zod internals or SQL. Existing public backend reads
may verify that response projection does not rewrite stored data, following the established tests.

| Behaviour / test name | Public seam and intended coverage |
| --- | --- |
| Default controller preserves nested fields allowed by their schemas | First red/green slice through app.request: nested declared password and loose unknown field survive, root password and undeclared root fields remain hidden. Observe create, item read, list and update. |
| Explicit output schemas hide nested secrets on every resource response | app.request with Collection.outputValidator selects nested public keys; create/id/list/update remain private while stored values remain intact. |
| Default output accepts ordinary nested unions and intersections | app.request: dictionary/object alternatives and intersections are parsed using supplied Zod schemas, with no automatic 500 for former ambiguity. Retain dictionary-key data semantics. |
| Default output preserves nested wrappers and recursive data | Adapt the existing meaningful wrapper/shared/lazy/recursive tests to ordinary schema behaviour. Finite recursive data succeeds; default/catch values follow their supplied schemas. Remove obsolete traversal-specific test matrices. |
| All resource responses project public output without changing stored data | Retain existing controller test for root password omission, loose root stripping, refined root models, explicit whitelists and explicit password exposure. |
| Output validator failures never return unfiltered resources | Retain existing invalid single/list/create/update checks, error envelopes and failed-write rollback. |
| Update projects output once inside its atomic mutation | Retain existing volatile-validator regression. |
| Output transforms cannot mutate nested stored data | Retain existing clone-isolation regressions for create and update, including existing records. |
| Public root identity remains unchanged | Retain existing output identity, validation and route regressions. |

Write the first changed behaviour test and confirm it fails for missing nested fields before changing
production code. Then make the minimum implementation pass and adapt the now-obsolete privacy tests
in vertical slices. Keep unrelated CRUD, resource scope, association and tenant coverage.

## Documentation and acceptance

The lead writes docs/ and examples/ alongside the coder's source/test work in this same worktree. Record
ADR 0031 and append a supersession note to ADR 0030. Keep historical plans intact. Update live references
that promise recursive privacy or automatic rejection of dynamic compositions.

Run bun run check, the new example, and the documented controller/nested-data/scope examples. Complete
a newcomer read for imports, starting directory, dependencies, expected output and cleanup. Review the
fixed code/docs commit range against this plan; an independent configured reviewer must report no
actionable findings before acceptance. Report any findings to the same coder and rerun affected checks.
