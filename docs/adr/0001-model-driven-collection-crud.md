---
status: superseded by ADR-0007
---

# Collections provide model-driven CRUD methods

Consuming applications define their data as Zod models, associate each model with a collection and register the collection with Hedra. Collections provide validated CRUD methods, making models and collections the primary application interface. Controllers will expose those methods through an HTTP API and introduce record IDs in the next step; this feature implements the collection methods without adding HTTP routes or record IDs.
