# Hedra

Hedra lets consuming applications define their data and expose it through collections.

## Language

**Model**:
The definition of the shape and validity of a resource type.

**Collection**:
A named set of one resource type, associating its model, storage name, endpoint and controller.

**Resource**:
An identifiable item governed by a model, such as one car or tenant.
_Avoid_: Record when referring to the application-facing item.

**Controller**:
The operations and rules for one resource type, independent of its web representation.

**Consuming application**:
An application built with Hedra that defines its own resource models and collections.

**Tenant**:
A distinct party served by a consuming application, with its own configuration and application records.

**Configuration**:
Definitions, settings and policies that govern how a tenant or environment behaves.
