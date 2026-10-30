# 0001 Model imports

## Context

Foundation models are part of the public interface. A `categories` path made those imports long, and a barrel was how an earlier codebase kept them short. Hedra publishes its public interface from `src/hedra.ts` and otherwise forbids a file that only re-exports.

## Decision

`src/models/models.ts` is the only barrel. It re-exports the model schemas and their validators. Code outside `src/models/` imports them from `#models`. A file inside `src/models/` imports a sibling by its path, so it does not import the barrel that exports it. `src/hedra.ts` exports the public models again. Apps import them from `hedra`. There is no `hedra/models` subpath.

## Consequences

Importing a model from `hedra` also loads the server module, because the package entry imports it. A new public model is exported from `models.ts` and again from `hedra.ts`. Any other barrel remains forbidden.
