# Hedra

This repository implements Hedra's phase 1 development milestone. Production readiness and access control remain later
work. Follow global guidance for coding conventions and the development and release workflow.

Before changing public interfaces, models, controllers or isolation, read [framework contracts](docs/contracts.md).
For runtime settings read [configuration](docs/configuration.md); for integration or deployment read [preview operation](docs/preview.md).
[The milestone agreement](docs/phase-1.md) records the accepted scope and exclusions.

## Purpose

Hedra is an opinionated framework for multi-tenant backends. Its intended users are external developers, including those
building with coding agents. Authski is its first proving ground.

Provide dependable, reusable foundations so developers can focus on application behaviour. Aim to save time, effort and
tokens by integrating established solutions to recurring infrastructure problems.

Design for:

- A clear developer experience, predictable contracts and useful documentation for humans and coding agents.
- Security considered throughout the framework's design.
- Sensible defaults, minimal configuration and a small resource footprint.
- Container-first hosting and portability between providers, keeping proprietary cloud dependencies optional.

Agent support means helping agents build applications with Hedra. Runtime agent integrations are outside the initial
milestone.

## Stack and extensibility

Use Bun, Hono, Zod, SQLite, Pino and `bun:test`, with Docker and Caddy for local hosting. Keep the initial stack
opinionated and integrated. Consider interchangeable foundational components in a later version when concrete
requirements justify them.

Consumers must be able to extend or replace default controller behaviour and use native Hono routes and middleware
alongside generated functionality.

## Phase 1: development milestone

The first milestone enables Authski and Hedra to be developed together. Production readiness is a later milestone.

Register consumer-defined Zod models once and derive:

- TypeScript types, input normalisation and validation.
- Database schema and basic CRUD operations.
- HTTP routes and OpenAPI documentation.

Derive behaviour at runtime; consumers supply model definitions and custom logic rather than owning generated
infrastructure source files.

Provide default, replaceable controllers. HTTP requests and direct programmatic calls must invoke the same controller
behaviour, including consumer overrides.

## Tenancy and data scope

Hedra's hierarchy ends at tenant → environment. Each tenant can have multiple environments.
Hedra has no Application entity.

Consumer-defined records belong to an environment. The datastore requires explicit tenant and environment context and
enforces both isolation boundaries independently of replaceable controllers.

## Framework responsibilities

Keep reusable framework contracts and implementations in Hedra. Consuming applications own their domain models, business
rules, interfaces and identity-provider protocols.

Keep HTTP handling, controller behaviour and datastore access distinct. Controllers remain usable without HTTP. Expose
the framework through deliberate public package exports.

Agree detailed public contracts feature by feature. Validate framework defaults and consumer customisation through both
HTTP and programmatic use. Historical implementations are reference material; bring their behaviour into scope by
agreement.

## Security and later milestones

Security is a design constraint from phase 1: validate input at trust boundaries, use safe datastore operations, enforce
tenant/environment isolation and handle outputs, errors and logs without exposing private data.

Access control belongs to phase 2 and should deny access by default when introduced. Phase 1 is a development milestone
without access control.

Cookies, sessions, CSRF protection, authentication and caching remain roadmap topics whose detailed scopes require
agreement.

## Agent skills

The plan file is [PLAN.md](PLAN.md) at the repo root. Design and acceptance use that file.

### Issue tracker

Issues live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default triage roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

