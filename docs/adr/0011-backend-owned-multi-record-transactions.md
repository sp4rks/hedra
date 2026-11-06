---
status: accepted
---

# Backends own transactions spanning resource and association records

Association creation and guarded resource deletion must commit with their reference checks, so the existing atomic single-record modifier is insufficient. Extend the generic Backend contract with a synchronous transaction session inside an asynchronous transaction method; SQLite owns the transaction and controllers retain resource and association rules. This prevents dangling links and partial nested creates without introducing model-aware storage or relying on one process's lock, while requiring injected backends to implement the same atomic capability.
