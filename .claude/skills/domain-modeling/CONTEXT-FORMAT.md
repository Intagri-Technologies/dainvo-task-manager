# CONTEXT.md Format

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.

## Layout in this workspace

Dainvo is multi-context: **each project is a context**, and it owns the terms it defines. `CONTEXT-MAP.md` at the workspace root lists the contexts and the edges between them:

```md
# Context Map

## Contexts

- [Desktop](./dainvo/CONTEXT.md): local-first Electron calendar and task app
- [Backend](./dainvo_supabase/CONTEXT.md): identity, licensing, billing, and cloud AI
- [Mobile](./dainvo_mobile/CONTEXT.md): Flutter companion app

## Relationships

- **Desktop → Backend**: the desktop app consumes license and entitlement DTOs; it never owns them
- **Desktop ↔ Mobile**: both sync buckets and tasks through Backend tables; the desktop is the local source of truth for calendar state
```

Resolution order when you need a term:

- Read the current project's `CONTEXT.md` first — it is authoritative for that project
- Read `CONTEXT-MAP.md` at the workspace root when a term crosses projects, or when you don't know which project owns it
- If neither exists yet, create the project's `CONTEXT.md` lazily when the first term is resolved, and add it to the map in the same edit

Each project's `CONTEXT.md` must be readable on its own, because an agent opened directly on that project never sees the workspace root. Never rely on the map to complete a definition.

When more than one context could own a term, infer from where the code lives. If it is genuinely shared, pick the project that defines the type and record the crossing as a relationship. If still unclear, ask.
