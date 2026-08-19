---
name: diagnosing-bugs
description: Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow.
---

# Diagnosing Bugs

A discipline for hard bugs. Skip phases only when explicitly justified.

When exploring the codebase, read the owning project's `CONTEXT.md` first for
the domain vocabulary, and `CONTEXT-MAP.md` at the workspace root when the bug
crosses repos.

## Redact

This skill has you show commands, outputs and captured artifacts. **Redact
every secret first**: write `<REDACTED>` in its place. Build loops against env
vars, so the credential stays in the environment rather than in what you show.
Provider payloads and captured artifacts in this workspace routinely carry auth
headers and tokens: quote only the lines that carry the signal.

If the redacted output is not enough to diagnose the bug, say so and ask the
user.

## Phase 1: Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a **tight**
pass/fail signal for the bug (one that goes red on _this_ bug), you will find
the cause; bisection, hypothesis-testing, and instrumentation all just consume
it. If you don't have one, no amount of staring at code will save you. Waiting
blind, guessing at setup, or proposing a fix without a real traceback is this
phase done wrong.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to
give up.**

### Loops at this workspace's seams, in rough order of preference

Pick the seam the bug actually lives at. Never call real provider APIs from a
loop — mock provider, Supabase, Stripe, filesystem-bridge, and network clients,
and keep real tokens out of fixtures.

1. **Failing vitest in `dainvo/`.** Renderer and shared code run under
   happy-dom without testing-library; repository and migration code runs
   against temporary or in-memory SQLite, never a real user DB. Run one file
   with `node scripts/run-vitest-node.mjs run <filter>`; the full gate is
   `pnpm test` (never bare `vitest` — it skips native rebuild and the
   directive checks).
2. **Main-process harness.** For IPC, sync, or service bugs, a small
   throwaway script that constructs the service with an in-memory SQLite DB
   and mocked provider clients, exercising the real handler path without
   booting Electron.
3. **Failing `deno test` in `dainvo_supabase/`.** Edge Function logic lives in
   `supabase/functions/_shared/*.test.ts`; run one file with
   `deno test --allow-env supabase/functions/_shared/<file>.test.ts`. RPC and
   migration SQL has pgTAP files, but **do not** reach for the local Supabase
   harness or Docker — both are forbidden here. If the bug is only observable
   against a live database, stop and ask the user; production pushes are
   theirs.
4. **Failing `flutter test` in `dainvo_mobile/`.** Flutter lives at
   `~/Developer/flutter-3.44.6/bin/flutter`; the profile default is too old.
5. **Failing vitest in `dainvo_ai_gateway/`.** `vitest run` for unit logic,
   `vitest run --config vitest.worker.config.ts` for Worker runtime behavior.
   `dainvo_ai_gateway/scripts/check-contract-sync.ts` is the loop for
   catalog/contract drift.
6. **Replay a captured artifact.** Save a real (redacted) provider payload,
   sync delta, or event log to disk and drive it through the mapper or
   repository in isolation — the standard move for provider-sync bugs, where
   the trigger is a payload shape, not a code path.
7. **Bisection harness.** The bug appeared between two known states: automate
   "boot at state X, check, repeat" so `git bisect run` can consume it. For
   installed-app reports, first separate current-source evidence from
   installed-artifact evidence — a UI label names where an error surfaced, not
   where it was thrown. `pnpm package:startup:smoke` exercises packaged
   startup.
8. **Differential loop.** Same input through two versions or two configs
   (desktop vs mobile mapper, old vs new migration), diffing the outputs.
9. **Property / fuzz loop.** For "sometimes wrong output", run hundreds of
   generated inputs through the pure helper and look for the failure mode.
10. **HITL bash script.** Last resort, for steps only a human can do (real
    OAuth consent, a provider dashboard, the installed app). Drive _them_ with
    [scripts/hitl-loop.template.sh](scripts/hitl-loop.template.sh) so the loop
    is still structured and captured output feeds back to you. Never blind-wait
    on "try it now" — script the steps and capture the observation.

### Tighten the loop

Treat the loop as a product. Once you have _a_ loop, **tighten** it:

- Can I make it faster? (One test file instead of the gate, skip unrelated
  init, narrow the scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't
  crash".)
- Can I make it more deterministic? (Pin time, seed RNG, in-memory SQLite,
  freeze network.)

A 30-second flaky loop is barely better than no loop; a 2-second deterministic
one is tight, a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the
trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps.
Sync races (outbox draining, dispatch ordering, lane pausing) are the usual
shape here: raise the rate until it's debuggable.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access
to whatever environment reproduces it, (b) a redacted captured artifact (HAR
file, log dump, support bundle, screen recording with timestamps), or (c)
permission to add temporary instrumentation. Do **not** proceed to hypothesise
without a loop.

### Completion criterion: a tight loop that goes red

Phase 1 is done when the loop is **tight** and **red-capable**: you can name
**one command** (a script path, a test invocation) that you have **already run
at least once** (show the invocation and its output, redacted), and that is:

- [ ] **Red-capable**: it drives the actual bug code path and asserts the
      **user's exact symptom**, so it can go red on this bug and green once
      fixed. Not "runs without erroring"; it must be able to _catch this
      specific bug_.
- [ ] **Deterministic**: same verdict every run (flaky bugs: a pinned, high
      reproduction rate, per above).
- [ ] **Fast**: seconds, not minutes.
- [ ] **Agent-runnable**: you can run it unattended; a human in the loop only
      via `scripts/hitl-loop.template.sh`.

If you catch yourself reading code to build a theory before this command
exists, **stop: jumping straight to a hypothesis is the exact failure this
skill prevents.** No red-capable command, no Phase 2.

## Phase 2: Reproduce + minimise

Run the loop. Watch it go red as the bug appears.

Confirm:

- [ ] The loop produces the failure mode the **user** described, not a
      different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for
      non-deterministic bugs, at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow
      timing) so later phases can verify the fix actually addresses it.

### Minimise

Once it's red, shrink the repro to the **smallest scenario that still goes
red**. Cut inputs, callers, config, data, and steps **one at a time**,
re-running the loop after each cut, and keep only what's load-bearing for the
failure.

Why bother: a minimal repro shrinks the hypothesis space in Phase 3 (fewer
moving parts left to suspect) and becomes the clean regression test in Phase 5.

Done when **every remaining element is load-bearing**: removing any one of them
makes the loop go green.

Do not proceed until you have reproduced **and** minimised.

## Phase 3: Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them.
Single-hypothesis generation anchors on the first plausible idea.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear /
> <changing Z> will make it worse."

If you cannot state the prediction, the hypothesis is a vibe: discard or
sharpen it.

**Show the ranked list to the user before testing.** They often have domain
knowledge that re-ranks instantly ("we just deployed a change to #3"), or know
hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't
block on it; proceed with your ranking if the user is AFK.

## Phase 4: Instrument

Each probe must map to a specific prediction from Phase 3. **Change one
variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats
   ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses — through
   the redacted logger, since payloads here carry tokens and database paths.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at
the end becomes a single grep. Untagged logs survive; tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead:
establish a baseline (the `measure:runtime` harness in `dainvo/`, a timing
script, a query plan), then bisect. Measure first, fix second. Range-first
loading is a standing rule here — "loads all rows" is a frequent culprit.

## Phase 5: Fix + regression test

Write the regression test **before the fix**, but only if there is a **correct
seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it
occurs at the call site. If the only available seam is too shallow
(single-caller test when the bug needs multiple callers, unit test that can't
replicate the chain that triggered the bug), a regression test there gives
false confidence.

**If no correct seam exists, that itself is the finding.** Note it. The
codebase architecture is preventing the bug from being locked down. Flag this
for the next phase.

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised)
   scenario.

## Phase 6: Cleanup

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway harnesses deleted (or moved to a clearly-marked debug location
      — not left at a repo root)
- [ ] The project's targeted checks from its `AGENTS.md` run clean, with
      pre-existing failures named as pre-existing
- [ ] The hypothesis that turned out correct is stated in the commit message,
      so the next debugger learns

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT),
`skills/engineering/diagnosing-bugs`: the loop menu is rewritten for this
workspace's seams, and the Docker-dependent options are gone because Docker and
the local Supabase harness are forbidden here. The canonical copy lives at
`skills/diagnosing-bugs/`; copies under each project's `.claude/`, `.codex/`,
and `.agents/` directories are generated by `scripts/sync-agent-skills.sh`.
