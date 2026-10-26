# Writing pages

Each page serves one reader job. Title and opening sentence state that job; anything serving another job moves to its own page and is linked from a closing **Next** or **Related** line.

## Tutorial chapter

The reader is learning. Give them one safe path, not options.

```markdown
# N. <What the reader adds to the app>

<One paragraph: where the app stands now and what it will do by the end.>

## <Action>
<One small step, its code, and what the reader should see.>

## Check your work
<A command and its expected output.>

## What you learned
<The concept, named and explained now that the reader has used it.>

Next: [N+1. <title>](...)
```

- Show first, explain after: the reader uses a concept before it is named.
- Every step ends with something visible: output, a response, a passing test.
- Keep options, edge cases and rationale out; link to the guide or concept instead.

## Guide

The reader is competent and has a task. Get them to the outcome without detours.

```markdown
# How to <outcome>

Assumes you've finished [Tutorial N: <title>](...). <When this guide applies.>

## Steps
1. <One action per step.>

## Verify
<How the reader confirms it worked.>

Related: <concept>, <reference>
```

- State prerequisites up front, and put each warning before the step it concerns.
- Branch only where the reader must choose.

## Concept

The reader wants to understand. Build a mental model, not a procedure.

```markdown
# <Concept>

## The problem
## How Hedra approaches it
## Trade-offs
## What this means for you
```

- Name the alternatives Hedra rejected and why; link the ADR when one exists.
- Describe the model, not the implementation, unless the implementation changes the model.

## Reference

The reader is looking something up. Make it complete and scannable.

```markdown
# <Subject> reference

<One sentence on scope.>

| Name | Type | Default | Description |
| --- | --- | --- | --- |
```

- Use the same structure for every entry in a page, and list every default and limit.
- Keep rationale out; link to the concept.

## Prose

- Second person, present tense: "you register a model", not "the user will register".
- One idea per sentence. Review any sentence over 25 words and split it unless that loses a relationship between ideas.
- One term per concept, matching `reference/glossary.md`; never rotate synonyms.
- Keep each claim's certainty: "may fail" stays "may fail". Add no fact the code doesn't support.
- Plain statements over salesmanship: drop "simply", "just", "powerful", "seamless", "easily".
- Vary sentence length; avoid stock AI patterns such as rhetorical questions, "not only X but Y", triads of adjectives, and closing summaries that repeat the page.
