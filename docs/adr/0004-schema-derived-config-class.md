---
status: accepted
---

# Store validated configuration directly on a class

`Config` owns environment resolution and validation, exposing resolved settings as direct properties. Derive each read-only property declaration from the Zod schema and assign the complete parsed output once, preserving convenient access without getters or repeated per-field assignments. Because `declare` does not prove initialization and `readonly` does not freeze JavaScript objects, constructor behaviour needs coverage; the base constructor remains usable by subclasses that initialize additional state.

The per-property declaration detail is superseded by [ADR 0021](0021-category-derived-configuration.md). The direct-property class design remains in effect.
