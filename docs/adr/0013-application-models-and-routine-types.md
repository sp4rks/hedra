---
status: accepted
---

# Use Zod for application models and TypeScript for routine wiring

Zod defines "in plane" objects: models of data the application works with, including resources, configuration values and transport or storage data, with types derived from their schemas. Routine options and dependency contracts, including `HedraOptions`, use plain TypeScript types or interfaces so they do not need runtime schemas solely to describe their shape. Hedra retains the `env`/`config` conflict check and configuration validation, including supplied subclass values, while unknown constructor properties are ignored and logger/backend method shapes are the caller's responsibility.
