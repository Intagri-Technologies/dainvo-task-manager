---
name: wayfinder
description: Plan a huge chunk of work (more than one agent session can hold) as a shared map of decision tickets, and resolve them one at a time until the way to the destination is clear.
disable-model-invocation: true
---

A loose idea has arrived, too big for one agent session, and wrapped in fog:
the way from here to the **destination** isn't visible yet. Wayfinding is about
finding that way, not charging at the destination. This skill charts the way as
a **shared map** of **decision tickets** (questions whose resolution is a
decision, not slices of a build to execute) and works them one at a time until
the route is clear.

The destination varies per effort, and naming it is the first act of charting:
it shapes every ticket. It might be a spec to hand off and iterate on, a
decision to lock before planning starts, or a change made in place like a
data-structure migration.

This workspace's tracker is **local markdown**, decided once for this skill and
its siblings: see [TRACKER.md](./TRACKER.md) for where maps live, the ticket
file format, and the claim/resolve/frontier operations. Dainvo's big pieces
usually span repos, so most maps live at the workspace root.

## Plan, don't do

Wayfinder is **planning** by default: each ticket resolves a decision, and the
map is done when the way is clear, with nothing left to decide before someone
goes and does the thing. The pull to just do the work is usually the signal
you've reached the edge of the map and it's time to hand off. An effort can
override this in its **Notes**, carrying execution into the map itself, but
absent that, produce decisions, not deliverables.

This is the existing house style made explicit: CLICKUP_PLAN and MONDAY_PLAN
were authored plan-first with zero implementation by explicit request. A map is
that discipline with the open decisions made first-class.

## Refer by name

Every map and ticket has a **name**: its title. In everything the human reads
(narration, the map's Decisions-so-far), refer to it by that name with its file
path as the link, never by a bare number. A wall of `03, 04, 07` is illegible;
names read at a glance.

## The Map

The map is `<effort>/map.md`, the canonical artifact. Its tickets are files in
`<effort>/issues/` (see [TRACKER.md](./TRACKER.md)).

The map is an **index**, not a store. It lists the decisions made and points at
the tickets that hold their detail; a decision lives in exactly one place, its
ticket, so the map never restates it, only gists it and links.

### The map body

The whole map at low resolution, loaded once per session. Open tickets are
**not** listed: they are found by scanning `issues/`.

```markdown
## Destination

<what reaching the end of this map looks like: the spec, decision, or change
this effort is finding its way to. One or two lines; every session orients to
it before choosing a ticket.>

## Notes

<domain; the owning projects and their CONTEXT.md files; skills every session
should consult; standing preferences for this effort>

## Decisions so far

<!-- the index: one line per resolved ticket -->

- [<ticket title>](./issues/NN-<slug>.md): <one-line gist of the answer>

## Not yet specified

<!-- see "Fog of war": in-scope fog you can't ticket yet -->

## Out of scope

<!-- work ruled beyond the destination; closed, never graduates -->
```

### Tickets

Each ticket is one file, its body the question, sized to one agent session. A
session **claims** a ticket by setting `Status: claimed` **first**, before any
work, so concurrent sessions skip it — other sessions of yours do edit these
repos in parallel.

Blocking is the `Blocked by:` header line. A ticket is **unblocked** when every
ticket it lists is resolved; the **frontier** is the open, unblocked, unclaimed
tickets, the edge of the known.

The answer isn't part of the body; it's recorded on resolution. Assets created
while resolving a ticket are linked from the ticket file, not pasted in.

## Ticket Types

Every ticket is either **HITL** (human in the loop, worked _with_ a human who
speaks for themselves) or **AFK**, driven by the agent alone. A HITL ticket
only resolves through that live exchange; the agent never stands in for the
human's side of it (answering your own interview questions has broken this).

- **Research** (AFK): Reading provider documentation, specs, or this
  workspace's own source to surface a fact a decision waits on. Resolved by a
  background agent via the `research` skill; findings land under the owning
  `docs/research/` per that skill's convention and are linked from the ticket.
  Use when knowledge outside the current conversation is required.
- **Prototype** (HITL): Raise the fidelity of the discussion with a cheap,
  rough, concrete artifact to react to — an outline, a stub, throwaway UI or
  logic code. No `prototype` skill is installed here: build the throwaway
  directly, keep it clearly disposable (scratchpad or a `*_prototype` file the
  cleanup phase deletes), and link it from the ticket. Use when "how should it
  look/behave" is the key question.
- **Grilling** (HITL): Conversation. The default case. Use the
  `grill-with-docs` skill, which runs `grilling` and `domain-modeling`
  together, so settled terms land in the owning `CONTEXT.md` as they
  crystallise and genuine trade-offs become ADRs.
- **Task** (HITL or AFK): Manual work that must happen before a _decision_ can
  be made: signing up for a service so its API can be judged, provisioning
  access, moving data so its shape can be seen. The one type that _does_
  rather than decides, earning its place by unblocking a decision. The agent
  drives it alone where it can (AFK); otherwise it hands the human a precise
  checklist (HITL) — anything touching production Supabase, App Store consoles,
  or OAuth dashboards is the human's, per standing rules. The answer records
  what was done and any resulting facts later tickets depend on.

## Fog of war

The map is _deliberately_ incomplete: don't chart what you can't yet see.
Beyond the live tickets lies the **fog of war**: the dim view of decisions and
investigations you can tell are coming but can't yet pin down, because they
hang on questions still open. Resolving a ticket clears the fog ahead of it,
graduating whatever's now specifiable into fresh tickets, one at a time, until
the way to the destination is clear and no tickets remain.

The map's **Not yet specified** section is where that dim view is written down.
Everything there is in scope, just not sharp enough to ticket. Write as loosely
or as fully as the view allows.

**Fog or ticket?** The test is whether you can state the question precisely
now, _not_ whether you can answer it now.

- **Ticket when** the question is already sharp, even if it's blocked and you
  can't act on it yet.
- **Not yet specified when** you can't yet phrase it that sharply. Don't
  pre-slice the fog: one patch may graduate into several tickets, or none,
  once the frontier reaches it.

## Out of scope

Fog only ever gathers _toward_ the destination. Work beyond it is **out of
scope**: it gets its own map section — work consciously ruled out of _this_
effort. When an existing ticket turns out to sit past the destination, resolve
it as out of scope (set `Status: resolved`, answer "out of scope: <why>") and
leave one line in the **Out of scope** section linking it. It stays out of
**Decisions so far**, which records the route actually walked.

Out-of-scope work returns only if the destination is redrawn, and then as a
fresh effort, not a resumption.

## Invocation

Two modes. Either way, **never resolve more than one ticket per session**, with
the exception of research tickets.

### Chart the map

User invokes with a loose idea.

1. **Name the destination.** Use the `grill-with-docs` skill to pin down what
   this map is finding its way to.
   The destination fixes the scope, so it's settled first. Where a plan
   document already exists (a `*_PLAN.md` with open decisions in it), read it
   first: it is usually the fog half-charted, and its open decisions are the
   first tickets.
2. **Map the frontier.** Grill again, **breadth-first**: fan out across
   the whole space rather than deep on any one thread, surfacing the open
   decisions and the first steps takeable now. **If this surfaces no fog**
   (the whole journey fits one session), you don't need a map. Stop and ask
   the user how they'd like to proceed.
3. **Create the map** per [TRACKER.md](./TRACKER.md): Destination and Notes
   filled in, Decisions-so-far empty, the fog sketched into **Not yet
   specified**.
4. **Create the tickets you can specify now**, then wire `Blocked by:` lines
   in a **second pass** (files need numbers before they can reference each
   other). Everything you can't yet specify stays in the fog.
5. **Fire the research agents.** For each `research` ticket, spin up a
   background agent via the `research` skill to resolve it in parallel; the
   findings file is linked from the ticket when it lands.
6. Stop: charting is one session's work; it hand-resolves nothing.

### Work through the map

User invokes with a map (path or effort name). A ticket is **optional**:
without one, you pick the next decision, not the user.

1. Load the **map**: the low-res view, not every ticket body.
2. Choose the ticket. If the user named one, use it. Otherwise take the first
   frontier ticket in order. **Claim it** before any work.
3. Resolve it. **Zoom as needed**: read the full body of any related or
   resolved ticket on demand; use whichever skills the map's `## Notes` names.
   When in doubt, use `grill-with-docs`.
4. Record the resolution per [TRACKER.md](./TRACKER.md): answer on the ticket,
   status resolved, one line in Decisions-so-far.
5. Add newly-surfaced tickets (create-then-wire); graduate any fog the answer
   has made specifiable, clearing each graduated patch from **Not yet
   specified**. If the answer reveals a ticket sits beyond the destination,
   rule it out of scope rather than resolving it on the route. If the decision
   invalidates other parts of the map, update or delete those tickets.

The user may run unblocked tickets in parallel from other sessions, so expect
concurrent edits.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT),
`skills/engineering/wayfinder`: the tracker is decided once as local markdown
(TRACKER.md, shared with any sibling skill installed later); research assets go
through the `research` skill instead of throwaway branches, which the git
guardrail blocks; and the prototype ticket type builds a disposable artifact
directly, since no `prototype` skill is installed. The canonical copy lives at
`skills/wayfinder/`; copies under each project's `.claude/`, `.codex/`, and
`.agents/` directories are generated by `scripts/sync-agent-skills.sh`.
