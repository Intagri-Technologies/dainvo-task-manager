---
name: research
description: Investigate questions, provider behavior, and feature gaps using primary sources. Answer small lookups with citations; save reusable findings for substantial investigations or when a report is requested.
---

# Research

Establish the question and the decision it supports. Reuse relevant evidence
already in context and existing research that is still current.

## Choose the scope

- **Small lookup:** resolve a bounded question in the current task and cite the
  answer. A separate agent or file is unnecessary unless requested or required
  by the calling workflow.
- **Substantial investigation:** for a multi-source audit, provider comparison,
  or reusable contract finding, save a concise cited report. Update an existing
  report when it covers the same question.
- **Delegation:** use a background agent for a bounded, independent investigation
  when useful work can continue locally, or when explicitly requested. Give it
  the question, relevant context, and expected output. Avoid automatic fan-out
  or repeating its completed searches without an unresolved reason.

Honor requested deliverables and calling workflows, including research tickets
that require a saved report and a link back to the ticket.

## Establish the findings

Use primary sources: official provider documentation, RFCs, specifications,
first-party API references, and the workspace's implementation. Follow factual
claims to the source that owns them. Inspect code before making claims about
what this workspace actually does.

Cite repo findings with the relevant file and line; cite external findings with
the owning document's URL. When documented behavior and observed implementation
differ, cite both and explain the difference. Use the project's glossary terms
where their meaning matters.

Separate observed behavior, documentation claims, and inference. State material
unknowns, inaccessible sources, and behavior that still needs live verification.
Do not treat a documentation lookup as proof of runtime behavior.

Stop when evidence answers the scoped question with appropriate confidence,
or further progress depends on unavailable evidence. Report that limitation;
avoid tangential investigation or repeated equivalent searches.

## Save reports safely

| Scope | Destination |
| --- | --- |
| One project with unpublished docs | `<project>/docs/research/` |
| Published docs or cross-project research | Workspace `docs/research/` |

Private research must stay out of `dainvo/docs/`, uploaded by `dainvo-site.yml`,
and `dainvo-docs/docs/`, the public help source. For other destinations, inspect
publishing configuration when visibility is unclear. Never leave reports loose
at the workspace root or include credentials or private user data.

Use `TOPIC_AUDIT_YYYY-MM-DD.md` for new reports. Keep findings tied to the question,
cite factual conclusions, and finish with material uncertainties. Return the
report path and the result briefly.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills), MIT.
Canonical source: `skills/research/`. Sync generated agent copies with
`scripts/sync-agent-skills.sh`.
