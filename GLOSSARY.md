# Hedra

Hedra lets consuming applications define their data and expose it through collections.

## Language

**Model**:
The definition of the shape and validity of a resource type.

**Collection**:
A named set of one resource type, associating its model, storage placement, endpoint and controller.

**Resource**:
An identifiable item governed by a model, such as one car or tenant. A resource can be independently stored or contained within another resource.
_Avoid_: Record when referring to the application-facing item.

**Contained resource**:
A resource stored inside its parent and sharing that parent's lifetime. It can contain further resources.

**Parent**:
The resource that contains another resource. A contained resource is addressed through its parent.

**Association**:
A link between independently stored resources that retain their own lifetimes.

**Controller**:
A reusable handler for a collection's REST operations, including server-owned attributes and public output filtering.

**Consuming application**:
An application built with Hedra that defines its own resource models and collections.

**Tenant**:
A distinct party served by a consuming application, with its own configuration and application records.

**Tenant domain**:
The unique, fixed domain name assigned to a tenant, directly below the deployment domain.

**Deployment domain**:
The root domain beneath which a deployment's tenants are named.

**Deployment API domain**:
The hostname used to manage a deployment's tenant catalogue.

**Configuration**:
Definitions, settings and policies that govern how a tenant or environment behaves.

**Configuration datastore**:
The persistent catalogue of configuration resources, beginning with tenant definitions, used by a consuming application.
