---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a CONTEXT.md, recording an ADR, or when a term in this workspace seems ambiguous or overloaded.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* `CONTEXT.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## Where the contexts live in this workspace

Dainvo is a multi-project workspace, and **each project is its own context**. `CONTEXT-MAP.md` at the workspace root lists them and how they relate.

```
Dainvo Project/
├── CONTEXT-MAP.md          ← the map: every context and the edges between them
├── dainvo/
│   ├── CONTEXT.md          ← desktop app vocabulary
│   └── docs/adr/           ← decisions scoped to the desktop app
├── dainvo_supabase/
│   ├── CONTEXT.md          ← backend, licensing, and cloud AI vocabulary
│   └── docs/adr/
└── dainvo_mobile/
    └── CONTEXT.md
```

Two rules follow from the layout:

- **Each `CONTEXT.md` must stand alone.** An agent opened directly on `dainvo/` never sees the workspace root above it, so a project's glossary may not depend on the map to be readable.
- **Shared terms live in the map, not duplicated.** When a term crosses projects (a desktop concept that a migration also names), define it once in the owning project's `CONTEXT.md` and record the crossing as a relationship in `CONTEXT-MAP.md`.

Create files lazily: only when you have something to write. A project with no vocabulary of its own gets no `CONTEXT.md`. If no `docs/adr/` exists, create it when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

This workspace has a specific version of that trap: the same word often means different things on either side of the desktop/backend seam. When a term appears in both `dainvo/` and `dainvo_supabase/`, confirm they mean the same thing before assuming it, and record the answer.

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there. Don't batch these up: capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else. File paths belong there only as a pointer to where a type is defined, never as an explanation of how it works.

When you add or rename a context, update `CONTEXT-MAP.md` in the same edit.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md). An ADR belongs to the project it constrains; a decision binding more than one project goes in the owning project's `docs/adr/` and is named as a relationship in `CONTEXT-MAP.md`.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT), `skills/engineering/domain-modeling`. The canonical copy for this workspace lives at `skills/domain-modeling/`; the copies under each project's `.claude/`, `.codex/`, and `.agents/` directories are generated. Edit the canonical copy, then run `scripts/sync-agent-skills.sh`.
