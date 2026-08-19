---
name: codebase-design
description: Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.
---

# Codebase Design

Design **deep modules**: a lot of behaviour behind a small interface, placed at
a clean seam, testable through that interface. Use this language and these
principles wherever code is being designed or restructured. The aim is leverage
for callers, locality for maintainers, and testability for everyone.

This is the *design* vocabulary. The *domain* vocabulary lives in the owning
project's `CONTEXT.md`; use both together, and when a term appears in both,
`CONTEXT.md` wins for domain meaning.

## Glossary

Use these terms exactly: don't substitute "component," "service," or "API."
Consistent language is the whole point.

**Module**: anything with an interface and an implementation. Deliberately
scale-agnostic: a function, class, package, or tier-spanning slice. _Avoid_:
unit, component, service.

**Interface**: everything a caller must know to use the module correctly: the
type signature, but also invariants, ordering constraints, error modes,
required configuration, and performance characteristics. _Avoid_: API,
signature (too narrow, they refer only to the type-level surface).

**Implementation**: what's inside a module, its body of code. Distinct from
**Adapter**: a thing can be a small adapter with a large implementation (a
provider client) or a large adapter with a small implementation (an in-memory
fake). Reach for "adapter" when the seam is the topic; "implementation"
otherwise.

**Depth**: leverage at the interface. The amount of behaviour a caller (or
test) can exercise per unit of interface they have to learn. A module is
**deep** when a large amount of behaviour sits behind a small interface,
**shallow** when the interface is nearly as complex as the implementation.

**Seam** _(Michael Feathers)_: a place where you can alter behaviour without
editing in that place; the *location* at which a module's interface lives.
Where to put the seam is its own design decision, distinct from what goes
behind it.

**Adapter**: a concrete thing that satisfies an interface at a seam. Describes
*role* (what slot it fills), not substance (what's inside).

**Leverage**: what callers get from depth. More capability per unit of
interface they learn. One implementation pays back across N call sites and M
tests.

**Locality**: what maintainers get from depth. Change, bugs, knowledge, and
verification concentrate in one place rather than spreading across callers.
Fix once, fixed everywhere.

### "Boundary" keeps its workspace meaning

Upstream avoids "boundary" as overloaded with DDD's bounded context. This
workspace already uses it precisely and for something else: a **trust or
process boundary** — main/preload/renderer in the desktop app, browser-safe
versus privileged in the web apps, the versioned AI planning boundary. Keep
that usage. A boundary is where *privilege* changes; a **seam** is where an
*interface* lives. Many seams sit on a boundary (the preload IPC surface is
both); most seams do not (a provider adapter interface inside the main process
is a seam on no boundary). Never say "boundary" when you mean seam.

## Deep vs shallow

**Deep module** = small interface + lots of implementation:

```
┌─────────────────────┐
│   Small Interface   │  ← Few methods, simple params
├─────────────────────┤
│                     │
│  Deep Implementation│  ← Complex logic hidden
│                     │
└─────────────────────┘
```

**Shallow module** = large interface + little implementation (avoid):

```
┌─────────────────────────────────┐
│       Large Interface           │  ← Many methods, complex params
├─────────────────────────────────┤
│  Thin Implementation            │  ← Just passes through
└─────────────────────────────────┘
```

When designing an interface, ask:

- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?

## Principles

- **Depth is a property of the interface, not the implementation.** A deep
  module can be internally composed of small, mockable, swappable parts; they
  just aren't part of the interface. A module can have **internal seams**
  (private to its implementation, used by its own tests) as well as the
  **external seam** at its interface.
- **The deletion test.** Imagine deleting the module. If complexity vanishes,
  it was a pass-through. If complexity reappears across N callers, it was
  earning its keep.
- **The interface is the test surface.** Callers and tests cross the same
  seam. If you want to test *past* the interface, the module is probably the
  wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real one.**
  Don't introduce a seam unless something actually varies across it.

## Where this bites in this workspace

The standing rule that provider-specific logic lives behind adapter/service
interfaces is a *seam placement* rule; this skill is the language for judging
whether a given adapter is any good. With eleven calendar, task, and meeting
providers behind those seams, the recurring questions are:

- Is this provider adapter **deep** — does the caller get sync, mapping, and
  error normalization for a small surface — or is it a shallow pass-through to
  the provider SDK that every caller must understand anyway?
- Provider adapters are category-4 dependencies in [DEEPENING.md](DEEPENING.md)
  (true external): the test adapter is a mock, and the mock-don't-call-real-
  services test rule follows from that, not from caution.
- The preload IPC surface is judged as an **interface** in the full sense
  above: its invariants and error modes are part of it, not just the TypeScript
  types. "Narrow typed APIs only" is a depth requirement.
- One adapter/two adapter: a second provider joining an interface is what
  proves the seam real. A seam built for a provider that never came is
  indirection to delete.

## Designing for testability

Good interfaces make testing natural:

1. **Accept dependencies, don't create them.**

   ```typescript
   // Testable
   function processOrder(order, paymentGateway) {}

   // Hard to test
   function processOrder(order) {
     const gateway = new StripeGateway();
   }
   ```

2. **Return results, don't produce side effects.**

   ```typescript
   // Testable
   function calculateDiscount(cart): Discount {}

   // Hard to test
   function applyDiscount(cart): void {
     cart.total -= discount;
   }
   ```

3. **Small surface area.** Fewer methods = fewer tests needed. Fewer params =
   simpler test setup.

## Relationships

- A **Module** has exactly one **Interface** (the surface it presents to
  callers and tests).
- **Depth** is a property of a **Module**, measured against its **Interface**.
- A **Seam** is where a **Module**'s **Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies the **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for
  maintainers.

## Rejected framings

- **Depth as ratio of implementation-lines to interface-lines** (Ousterhout):
  rewards padding the implementation. We use depth-as-leverage instead.
- **"Interface" as the TypeScript `interface` keyword or a class's public
  methods**: too narrow: interface here includes every fact a caller must
  know.
- **"Boundary" as a synonym for seam**: reserved in this workspace for trust
  and process boundaries; see the glossary note above.

## Going deeper

- **Deepening a cluster given its dependencies**, see
  [DEEPENING.md](DEEPENING.md): dependency categories, seam discipline, and
  replace-don't-layer testing.
- **Exploring alternative interfaces**, see
  [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md): spin up parallel sub-agents to
  design the interface several radically different ways, then compare on
  depth, locality, and seam placement.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT),
`skills/engineering/codebase-design`: the "avoid boundary" note is replaced
with this workspace's reconciliation, and the workspace-grounding section is
new; DEEPENING.md and DESIGN-IT-TWICE.md are unmodified. The canonical copy
lives at `skills/codebase-design/`; copies under each project's `.claude/`,
`.codex/`, and `.agents/` directories are generated by
`scripts/sync-agent-skills.sh`.
