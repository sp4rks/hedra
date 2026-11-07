---
status: accepted
---

# Derive configuration from category definitions

Category entries already describe each setting, but separately listing their schemas and class properties makes additions require changes in three places. Preserve literal property names and precise Zod schema types in the category definitions, derive the complete values schema from their merged entries, and infer the readonly `Config` instance properties from that schema. This keeps `new Config()`, native values, exact enum types and direct property access while making category definitions the single source of truth.

The generated schema shape needs a local type assertion because `Object.fromEntries` does not retain the relationship between an entry's property name and its schema. Those entries are trusted source code; loaded configuration still passes through Zod during construction. Readonly properties remain a TypeScript guarantee, and subclasses may initialize additional state.

This supersedes the per-property declaration detail of [ADR 0004](0004-schema-derived-config-class.md). Config-owned environment loading and validation during construction remain as recorded in [ADR 0014](0014-config-owned-environment-loading.md) and [ADR 0017](0017-validate-config-on-load.md).
