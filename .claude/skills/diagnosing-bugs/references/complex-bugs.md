# Complex bugs

Use this path when evidence leaves competing causes, an attempted fix fails,
or the bug involves intermittent behavior or performance. Apply only the
techniques that resolve the current uncertainty.

## Find a useful reproduction

Prefer an existing targeted test. If needed, replay a redacted artifact or
exercise the real service/handler through a small harness with isolated state.
Choose the boundary that exhibits the symptom, including multiple callers or
sync stages when they are part of the failure.

Make the signal specific to the reported bug. Pin time, random seeds, and
network responses where useful. Minimize the scenario enough to distinguish
causes or create a maintainable regression test. Stop reducing it when further
cuts do not change the next decision; an exhaustive minimal example is optional.

For human-only steps such as OAuth consent or an installed-device action,
provide a short sequence and request the observed result. Use the optional
[interactive template](../scripts/hitl-loop.template.sh) only when repeated
manual trials justify it and the user can interact with its terminal. Never
collect credentials through its capture prompts.

## Test explanations

Start with the explanation best supported by evidence. When alternatives remain,
rank only plausible causes and choose a probe whose result distinguishes them.
State the predicted observation before probing. Change one causal variable at
a time and update the explanation from the result.

Use a debugger or focused, redacted logs at the relevant boundary. Give temporary
logs a unique searchable prefix so cleanup is reliable. Share findings that
change the approach; no fixed hypothesis count or report is required.

If repeated probes add no information, reassess the reproduction, boundary, and
available artifacts before another attempt. Continue independent inspection;
request a missing observation when it prevents a reliable conclusion.

## Intermittent failures

Measure the baseline failure rate over a bounded set of trials. Control timing
or scheduling to expose the race; add stress only when it tests a specific
explanation. Record trial counts and relevant conditions before and after the
fix. One passing run does not establish that an intermittent failure is fixed.

## Performance regressions

Measure before editing. Use a representative workload and the relevant profiler,
timing harness, or query plan. Compare under the same conditions and check for
noise. Inspect range/page/account bounds when excessive loading is implicated.
Use bisection or differential runs when known versions can isolate the change,
while preserving unrelated work and following the project's Git restrictions.

## Lock down the cause

Where practical, turn the reproduction into a failing regression test, apply
the fix, and verify both that test and the original scenario. Reuse these results
for the final verification when no relevant code changed afterward. If the
available test boundary cannot express the real failure, explain that limitation
and the evidence available; avoid a shallow test that gives false confidence.
