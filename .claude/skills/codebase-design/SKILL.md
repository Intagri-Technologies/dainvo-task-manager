---
name: codebase-design
description: Design or improve module interfaces, seam placement, and testability. Use when evaluating module depth or when another skill needs this design vocabulary.
---

# Codebase design

Design deep modules: useful behavior behind a small interface, with complexity
concentrated where it can be maintained and tested. Inspect the affected code
and callers before proposing changes; keep the design within the task's scope.

This is design vocabulary. The owning project's `CONTEXT.md` remains
authoritative for domain meaning when terms overlap.

## Vocabulary

Use these terms consistently in design discussions. Component, service, API,
and type signature are not interchangeable substitutes.

- **Module:** an interface and its implementation, at any scale from a function
  to a package or tier-spanning slice.
- **Interface:** everything callers must know: signatures, invariants, ordering,
  errors, configuration, and performance characteristics. It includes more
  than a TypeScript `interface` or public method list.
- **Implementation:** the code inside a module. This describes substance;
  adapter describes a role.
- **Depth:** useful behavior relative to how much interface callers must learn.
  A shallow module exposes nearly as much complexity as it implements. Depth
  is not a ratio of implementation lines to interface lines.
- **Seam:** a place where behavior can be changed without editing that place,
  such as where a replaceable implementation satisfies a module's interface.
- **Adapter:** a concrete implementation satisfying an interface at a seam.
- **Leverage:** capability callers and tests gain per unit of interface learned.
- **Locality:** change, bugs, knowledge, and verification concentrated in one
  place rather than scattered across callers.

## Boundary has a separate meaning

In Dainvo, boundary means a trust or process boundary: main/preload/renderer,
public browser versus privileged backend, or the versioned AI planning contract.
A seam concerns interface placement. Preload IPC is both; a provider adapter
inside main is a seam without a privilege boundary. Preserve this distinction
and the existing trust boundaries when restructuring code.

## Evaluate the design

- Reduce what callers must know. Simplify methods and parameters, and hide
  repeated policy, mapping, or error handling where it belongs.
- Apply the deletion test: would removing the module eliminate indirection,
  or spread its complexity back across callers?
- Justify replaceable behavior with real adapters, including production and
  test implementations. Avoid seams for hypothetical future providers.
- Test observable behavior through the caller-facing interface. Keep internal
  seams private; a deep module can contain smaller, independently tested parts.
- Inject dependencies that need substitution. Keep pure computation returning
  results separate from effects so tests need not reproduce hidden setup.

Provider adapters should hide provider-specific sync, mapping, and errors,
rather than make every caller understand the SDK. Automated tests use mocks
for external services. Preload's invariants and error modes are part of its
interface; narrow types alone do not establish depth.

## Further guidance

- For merging a cluster of shallow modules, read [DEEPENING.md](DEEPENING.md)
  for dependency categories, adapter placement, and replacement test coverage.
- When alternative interfaces would resolve a real tradeoff, read
  [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md). Parallel agents are optional.

Routine interface edits do not require either reference or a design exercise.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT.
Canonical source: `skills/codebase-design/`. Sync generated agent copies with
`scripts/sync-agent-skills.sh`. `DEEPENING.md` retains its upstream guidance.
