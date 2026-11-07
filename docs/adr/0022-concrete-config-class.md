---
status: accepted
---

# Keep Config as a concrete loader

`Config` does not need an extension interface. Export its readonly value type from the category-derived Zod schema and its constructor as a named class expression, using a local constructor type assertion to describe the complete parsed values assigned during construction. This removes interface merging and its lint suppression while retaining `new Config()`, runtime class identity, exact property types and single-source setting definitions.

Environment-file loading, native-value validation and startup reporting belong to private static methods on the class. They share no instance state and provide no overridable loading hooks. Consumers use the validated instance directly.

This supersedes the interface-merging detail of [ADR 0021](0021-category-derived-configuration.md). The constructor remains responsible for complete initialization and validation; readonly remains a TypeScript guarantee.
