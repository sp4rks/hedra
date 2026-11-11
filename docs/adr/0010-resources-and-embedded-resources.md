---
status: superseded by ADR-0029
---

# Independent resources and embedded resources have different lifetimes

Hedra distinguishes independently stored `Resource` values from `EmbeddedResource` values contained within another resource according to its model's shape. Independent resources can share associations and have canonical collection routes; embedded resources share their containing resource's lifetime and have only nested routes, while retaining server-managed identities and timestamps. This keeps actual ownership explicit in storage without restricting containment to arrays, with association paths providing navigation rather than ownership or exclusivity, and allows embedded mutations to commit atomically with their containing document.

[ADR 0029](0029-parent-declared-contained-collections.md) replaces the separate schema marker and
inferred routes with one Resource model and explicit parent-declared collections. The independent
reference and contained-lifetime distinction remains.
