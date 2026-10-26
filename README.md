# Hedra

Hedra is a framework for building multi-tenant applications: one deployment serves many tenants, each with its own data and configuration. It is written in TypeScript, runs on Bun, and ships as a single process that runs anywhere a container does.

## Design goals

### Cloud agnostic

Cloud-native services set like concrete: once you are deployed on them at scale, you are not moving on any meaningful timescale. Hedra deliberately avoids cloud-native services so you can deploy it:

- wherever you want,
- however you want,
- whenever you want.

### Modern

Hedra uses newer tools and approaches that speed up development and resonate with emerging developers. It is designed from the ground up to run as a containerised SaaS, without compromises or accommodations for legacy approaches.

Hedra is also built to be agent friendly, so coding agents can work on it as readily as people. Consistent patterns, schema-derived types and fast tests give an agent clear signals about what to write and whether it worked, and `AGENTS.md` tells agents how to work in this repo.

### Fast

Not because it's cool, but because speed cuts run costs and carbon emissions. Public cloud has become the default deployment model and its margins are bloating, so many companies will move to a more measured, hybrid mix of SaaS, public cloud and private cloud. Low run costs are key to that business case.

### Simple

As companies move back towards private cloud, simplicity becomes a deciding factor. Hedra stays simple through:

- extensive, sensible defaults;
- simple, reusable design patterns, both under the hood and in the driver's seat;
- a monolithic architecture whose complexity scales with your requirements: one process per instance, with modules calling each other in-process rather than over the network.

### Secure

Hedra is written exclusively in TypeScript, whose static types catch whole classes of error before they ship. Zod schemas are the single source of truth for both types and validation: every type is inferred from a schema, so what the compiler checks and what runtime validation enforces cannot drift apart. Simplicity is its own kind of security. Untrusted code runs in gVisor, a user-space kernel that sandboxes it from the host.
