---
status: accepted
---

# Validate complete resource candidates inside the controller transaction

Public request validation alone cannot enforce a model rule spanning current and changed attributes without a read/validate/write race. Web therefore validates incoming fields, while controllers run the pure model validator on the complete candidate inside the datastore transaction and persist only its parsed, valid result. This supersedes ADR 0009's placement of all model input validation in web, while retaining nongeneric controllers with per-call collection context, server-managed metadata, separate output projection and model-independent ConfigStore operations.
