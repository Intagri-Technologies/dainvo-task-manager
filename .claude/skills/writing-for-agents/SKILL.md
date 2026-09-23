---
name: writing-for-agents
description: Write or revise agent instructions in skills, AGENTS.md, CLAUDE.md, and their supporting references. Use for instructions that guide agent behavior, not ordinary product documentation.
---

# Writing for agents

Write instructions that change useful behavior. Keep the guidance that improves
quality or protects a real constraint; shorten repeated explanation and process
that does not help the task.

## Establish scope

Inspect the current instructions and the implementation or configuration they
refer to. Identify the canonical source and edit it there. Preserve user intent,
authorization boundaries, and project-specific safeguards. Resolve stale rules
against current evidence rather than silently copying or deleting them.

Reuse material already in context. Load supporting files only for the behavior
being changed.

## Organize for use

- Put purpose, routing, and essential constraints in the entrypoint.
- Link substantial guidance used by only one branch from that branch. State
  when to read it and what decision it helps make. Keep small, shared rules
  inline; avoid splitting a short document just to reduce its word count.
- Keep each rule in one authoritative place. Group its definition, action,
  and exceptions together. Prefer a reference over repeating the rule.
- Keep discoverable configuration in its source. Document the non-obvious
  convention or gotcha, not a cached list of scripts or tool versions.

## Make instructions actionable

Use concrete verbs and established project terms. State the desired action
positively; retain explicit prohibitions for hard constraints. Avoid invented
jargon, motivational prose, and generic advice the agent already follows.

Give each workflow a checkable outcome and a stopping condition proportional
to the task. Distinguish required steps from optional techniques. Require
exhaustive coverage only where omissions matter; make routine cases cheap.

Write triggers around distinct cases, without synonym lists or catchalls.
Before adding mandatory reads, tests, reports, delegation, or approval steps,
identify the failure they prevent. Respect existing user authorization.

## Validate the edit

Check that a routine task reaches only its relevant instructions, a complex
case can find the detail it needs, and essential constraints remain visible.
Verify references and executable examples affected by the edit. Reuse current
validation; avoid tests that merely match the document's wording.

For skill metadata, invocation, or packaging changes, consult
[skill mechanics](SKILL-MECHANICS.md). For instruction failures that persist
after a focused edit, consult [instruction design](references/instruction-design.md).
Neither reference is required for routine prose edits.

Sync generated copies through the workspace's existing mechanism. Report the
behavioral change and validation briefly; describe size reductions as text
measurements, not proven runtime token savings.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT.
Canonical source: `skills/writing-for-agents/`. Sync generated agent copies with
`scripts/sync-agent-skills.sh`.
