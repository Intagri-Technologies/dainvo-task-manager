---
name: domain-modeling
description: Define or revise domain concepts, relationships, glossary entries, and consequential design decisions. Use for domain-model changes or terminology ambiguity that affects behavior; ordinary use of an existing term does not require a modeling exercise.
---

# Domain modeling

Keep the project's language consistent with its intended behavior and actual
implementation. Match the work to the question; a terminology clarification
does not require redesigning the domain.

## Resolve the term first

Read the relevant entries in the owning project's `CONTEXT.md`, reusing current
evidence already in context. Use `CONTEXT-MAP.md` for cross-project meanings or
unclear ownership. Inspect the affected code when behavior or ownership is at
issue.

If an existing definition answers the question, explain it and stop. For vague
or overloaded language, propose a precise term grounded in the glossary and
code. Ask the user only when unresolved alternatives would change the behavior,
ownership, or decision. Avoid a new interview for an incidental wording choice.

When the glossary, user intent, and implementation disagree, state the mismatch.
Distinguish current behavior from a proposed change; do not silently treat one
as the other. The same word can mean different things in desktop and backend,
so verify the meaning on each side before assuming they match.

## Develop the model when needed

For new or changed domain relationships, use concrete scenarios to test the
uncertain distinction. Probe relevant edge cases until the decision is clear;
leave unrelated concepts alone. Honor a requested modeling or interview workflow
and its required outputs.

Once a new definition or changed meaning is settled, capture it promptly in the
owning `CONTEXT.md` using [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md). Reusing an
existing definition needs no document edit.

Keep the glossary about domain meanings. Implementation plans, specifications,
and scratch notes belong elsewhere. File paths may point to type definitions,
but should not explain implementation inside the glossary.

## Keep ownership clear

Each project owns its context. Its `CONTEXT.md` must stand alone. Define a term
once in its owning project, and record cross-project relationships in the
workspace `CONTEXT-MAP.md` rather than duplicating definitions.

Update the map when a context is added or renamed, or a relationship changes.
Create glossary files only when there is project-specific vocabulary to record.
Do not create empty glossaries or ADR directories as setup work.

## Record consequential decisions

Offer an ADR only when the decision is all of the following:

1. Hard to reverse at meaningful cost.
2. Surprising to a future reader without context.
3. The result of a real tradeoff between alternatives.

Otherwise, skip it unless explicitly requested. For a qualifying or requested
ADR, use [ADR-FORMAT.md](ADR-FORMAT.md). Record the decision and why it was made;
a single paragraph may be sufficient.

Follow the project's or calling workflow's ADR destination. Otherwise, use the
owning project's `docs/adr/` when unpublished. Keep private ADRs out of the
published `dainvo/docs/` and `dainvo-docs/docs/` trees; use workspace `docs/adr/`
for those projects. Link decisions that constrain multiple projects from
`CONTEXT-MAP.md`.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT.
Canonical source: `skills/domain-modeling/`. Sync generated agent copies with
`scripts/sync-agent-skills.sh`.
