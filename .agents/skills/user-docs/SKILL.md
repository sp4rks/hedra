---
name: user-docs
description: Write and maintain Hedra's user-facing docs in docs/ as a layered journey. Use when a change alters what Hedra's users see, write or run, or when asked to write, restructure or review the user docs.
---

# User docs

Hedra's user docs take a newcomer on a **journey**: a tutorial that builds one running example, then guides, concepts and reference that layer on top of it. Every page assumes only what the pages before it taught. Write from the reader inward: start from where the reader is in the journey, never from the code you just changed.

## The docs set

```
docs/
├── index.md            the map: journey order and every section
├── tutorial/NN-<slug>.md
├── guides/<topic>/<task>.md
├── concepts/<topic>.md
├── reference/<subject>.md
│   └── glossary.md     every Hedra term, linked to the chapter that introduces it
└── adr/                contributor decisions; not part of the journey
examples/tutorial/NN-<slug>.ts
```

The four sections are the Diátaxis types: **tutorial** (learn by doing), **guides** (do a task), **concepts** (understand why), **reference** (look up facts). Every page serves exactly one.

Group guides and concepts by the topics readers expect from any backend framework: tenancy, data and models, routing, configuration, security, testing, deployment, observability. Add a topic when its first page arrives, and name it the way the reader would, not the way the code does.

If `docs/index.md` is missing, create the set above with only the pages the current change needs.

## Layering rules

- **One running example.** The tutorial builds a single small app. Each chapter starts from the previous chapter's code, adds one concept, and ends with the app working. Its code lives in `examples/tutorial/NN-<slug>.ts`, and the chapter's code blocks match that file exactly.
- **No term before its chapter.** A Hedra term first appears in the tutorial chapter that introduces it, and `reference/glossary.md` links the term to that chapter. Any later page uses the term without redefining it and links to the glossary on first use.
- **Guides and concepts stand on the tutorial.** Each opens with the chapter it assumes ("Assumes you've finished [Tutorial 3: Tenants](...)") and introduces nothing a beginner needs before that point.
- **The journey reads in order.** `index.md` lists the tutorial first, then topics from most to least commonly needed. Each page ends with a link to the natural next page.

## Workflow

1. **Place the change.** Read `docs/index.md`. For each user-visible change, decide which pages it touches: a tutorial chapter if a beginner needs it, a guide if it enables a task, a concept if it changes how Hedra should be understood, and reference for every new or changed option, route, error or export. Done when every user-visible change maps to a page, or is recorded as having no doc impact.
2. **Write the pages.** Follow [PAGES.md](PAGES.md) for the page's type. When a new concept belongs early in the tutorial, extend the chapter where the reader first needs it rather than appending a chapter at the end; renumber and fix links if you insert one.
3. **Update the neighbours.** Revisit the page before and after each changed page, `index.md` and `reference/glossary.md`, so the journey still reads in order and every term still has its introducing chapter.
4. **Run the examples.** Every tutorial code block matches its example file, and each example runs with `bun run` and behaves as its chapter says. When the docs are written alongside the code, the new examples may fail until the feature lands; they fail only because it isn't built yet.
5. **Review as a newcomer.** Launch a subagent with no prior context and the prompt below. Fix every finding, then review again. Done when a review returns no findings.

```text
You are a developer new to Hedra. Read docs/index.md, then follow the journey in order.
Read only files under docs/ and examples/; do not open src/ or tests/.
Report, with file and line:
- every term used before it was explained,
- every step where you could not tell what to do next or what you should see,
- every page that mixes learning, doing, looking up and understanding,
- every place a page assumes something its prerequisites did not teach.
Report "no findings" if there are none.
```
