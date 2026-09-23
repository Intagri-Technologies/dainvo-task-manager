---
name: diagnosing-bugs
description: Diagnose reported bugs, failing checks, and performance regressions. Use existing evidence for straightforward fixes; deepen the investigation when the cause is uncertain or the first fix fails.
---

# Diagnosing bugs

Match the investigation to the uncertainty. Read the affected implementation
before changing it; reuse relevant evidence already in context.

## Start with the evidence

Identify the expected behavior, actual symptom, affected version, and owning
project. Inspect the relevant error, failing check, or captured artifact and
trace it to the responsible code. For installed-app reports, distinguish the
installed artifact from current source; the screen showing an error may not
own its cause.

Use the nearest `AGENTS.md` and current test scripts. Read relevant glossary
entries only when domain meaning matters. Check the configured toolchain
rather than relying on remembered commands or machine-specific paths.

## Straightforward fixes

Use this path when the evidence identifies a cause and a bounded correction.

1. Confirm that the responsible code explains the reported symptom. An existing
   failing test, compiler error, or validated input can supply the reproduction;
   a separate harness is unnecessary when it adds no evidence.
2. Make the smallest correction that addresses the cause. For behavior changes,
   add or adapt a regression check that exercises the actual failure. Prefer
   demonstrating failure before the fix when the check can run locally.
3. Rerun the original failing check or scenario, then the project's relevant
   checks. Reuse passing results while the affected code remains unchanged.

Escalate when the cause remains uncertain, verification contradicts the theory,
or a fix fails. Read [complex bugs](references/complex-bugs.md) for that path,
intermittent failures, or performance investigations. Do not cycle through
speculative patches.

## Keep experiments safe

- Redact credentials, auth headers, provider payloads, database paths, and
  private user data in output. Show only evidence needed to explain a finding.
- Mock provider, Supabase, Stripe, filesystem-bridge, and network clients in
  automated tests. Use synthetic or redacted fixtures and temporary/in-memory
  databases, never real user databases or production services.
- Follow the owning project's current rules for local services and database
  resets. A reproduction does not authorize destructive or live mutations.
- If local reproduction is unavailable, continue useful source/artifact
  inspection and state which conclusions remain unverified. Ask only for the
  missing observation or access needed to proceed safely.

## Finish

Remove temporary instrumentation and harnesses you added. Confirm the original
symptom is covered, rather than merely showing that a helper passes. Report the
cause, correction, verification, and material gaps briefly. Distinguish observed
results from inference and unrelated failures. Stop when the fix is verified;
reopen investigation only for new evidence.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT.
Canonical source: `skills/diagnosing-bugs/`. Sync generated agent copies with
`scripts/sync-agent-skills.sh`.
