# Hedra

Hedra lets consuming applications define their data and expose it through collections.

## Language

**Model**:
The definition of the shape and validity of a resource type.

**Collection**:
A named set of one resource type, associating its model, storage name, endpoint and controller.

**Resource**:
An independently stored, identifiable item governed by a model, such as one car or tenant. A resource has its own lifetime and can be associated with other resources.
_Avoid_: Record when referring to the application-facing item.

**EmbeddedResource**:
An identifiable item contained within another resource and sharing its lifetime. Embedded resources can themselves contain embedded resources.
_Avoid_: ChildResource, SecondaryResource

**Association**:
A link between independently stored resources that retain their own lifetimes.

**Controller**:
A reusable handler for a collection's REST operations, including server-owned attributes and public output filtering.

**Consuming application**:
An application built with Hedra that defines its own resource models and collections.

**Tenant**:
A distinct party served by a consuming application, with its own configuration and application records.

**Configuration**:
Definitions, settings and policies that govern how a tenant or environment behaves.
