---
status: accepted
---

# Inject configuration operations and let the datastore configure storage

Hedra needs independently replaceable storage responsibilities without knowing their database implementations. It accepts a structural `ConfigDatastore` contract exposing tenant operations; the default `ConfigStore` resolves its backend from the loaded Config inside the datastore module. Hedra constructs the default on first use and closes it with the app, while injected datastores and backends remain borrowed. This extends [ADR 0009](0009-rest-controller-interface.md)'s separation of programmatic configuration operations from REST controllers and revises its configuration-store construction: ConfigStore may now own a connection. The application backend remains separate, backend transactions retain their existing scope, and sharing a connection is explicit rather than inferred from another dependency.
