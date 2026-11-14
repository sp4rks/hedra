---
status: accepted
---

# Web validators own public output

Resource models describe stored data. Controllers return complete resource envelopes. Generated web
routes apply the output Zod object supplied to `Hedra.register(collection, { output })` once to each
resource returned by create, item reads, lists and update, including custom controller results. Use
the parsed result directly, with no framework key selection before or after parsing.

The default is a fresh stripping Zod object containing the model's declared top-level fields except
`password`. It retains each field schema unchanged and omits object-level refinements that may depend
on the omitted password. Explicit output objects follow native Zod semantics: ordinary objects strip
extra fields, loose objects retain them, strict objects reject them, and catchalls validate them.
Fields added by output overwrites remain in the response. Nested schemas, defaults and transformations
follow the supplied schemas without recursive privacy inference or framework-specific markers.

This replaces controller-owned projection and unconditional declared root-key filtering. Applications
must review explicit loose, strict and catchall output schemas: loose schemas can now expose undeclared
private fields, and strict or catchall schemas can reject fields that previously disappeared before
validation. Select stripping output schemas to keep undeclared fields private. Fields such as `token`
remain public by default; models alone do not make a field secret. HTTP filters still require fields
declared in both the stored model and the output object.

The web layer detaches controller data before output callbacks run. Preserve lossless JSON checks on
the controller envelope and parsed resources, require each output resource to remain an object, and
reject changes to any exposed root ID. Single-resource controller results must also match the requested
ID even when the output schema omits it. Nested values have no separate identity contract. Validation
failures never fall back to raw data, and generated errors redact internal details.

Output validation runs after the controller completes. A failed create or update response returns 500
with `Transaction succeeded, but response validation failed.`; the completed write remains committed.
Complete-candidate and storage failures inside the controller transaction still roll back the write.
Programmatic controller callers receive complete resources and apply their own output policy.

This retains the root-only CRUD and ordinary nested storage in
[ADR 0030](0030-root-crud-and-ordinary-nested-data.md) and the complete-candidate transactions in
[ADR 0012](0012-atomic-candidate-validation.md). Stored data needs no rewrite.
