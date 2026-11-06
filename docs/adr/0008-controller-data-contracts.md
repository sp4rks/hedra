---
status: superseded by ADR-0009
---

# Controllers accept typed data without resource models

Resource models define data and provide pure validators; the future Web layer derives its public-input validators from them. Controllers accept plain typed data and explicitly enforce sensitive-field rules, including server-owned resource identity, without accepting or parsing a resource model. This supersedes [ADR 0007](0007-resource-controllers-and-generic-backends.md)'s placement of model validation in controllers; collections still hold resource definitions and select controllers, while model-agnostic backends retain transaction, JSON integrity and connection ownership. Programmatic callers run a pure validator themselves when they need model normalisation, defaults or refinements.
