# Issue tracker: Local Markdown (workspace decision, 2026-08-19)

This workspace's tracker is **local markdown files**, decided once for
`wayfinder` and for any sibling skill later installed that asks for "the issue
tracker" (`to-spec`, `to-tickets`, `triage`, `implement`). There is no GitHub
Issues convention here, and the eight repos should not each grow one.

## Where an effort lives

Same ownership rule as the `research` skill, including its publication guard:

| Scope | Location |
| --- | --- |
| One project, unpublished `docs/` | `<project>/docs/wayfinder/<effort-slug>/` |
| One project with a **published** `docs/` tree | `docs/wayfinder/<effort-slug>/` at the workspace root |
| Cross-project (most Dainvo big pieces) | `docs/wayfinder/<effort-slug>/` at the workspace root |

**Never put a map or ticket under `dainvo/docs/` or `dainvo-docs/docs/`** —
both trees are published (`dainvo-site.yml` uploads the former wholesale to
GitHub Pages; the latter is the Docusaurus source for `dainvo.com/docs`), and a
map is a list of undecided internals.

Most wayfinder-sized efforts here span repos — bucket sync crossed three, a
provider integration touches desktop, backend, gateway, and mobile — so the
workspace root is the usual home anyway. Note the root is not a git
repository: cross-project maps have no history until that changes.

## Layout

- **Map**: `<effort>/map.md` — Destination / Notes / Decisions so far /
  Not yet specified / Out of scope, per the wayfinder skill.
- **Ticket**: `<effort>/issues/NN-<slug>.md`, numbered from `01`, one file per
  ticket, never a combined file.

## Ticket file header

```markdown
# <ticket title>

Type: research | prototype | grilling | task
Status: open | claimed | resolved
Blocked by: NN, NN        <!-- omit the line when nothing blocks it -->

## Question

<the decision or investigation this ticket resolves>
```

## Operations

- **Frontier**: scan `<effort>/issues/` for `Status: open` files whose
  `Blocked by:` list is empty or entirely `resolved`. First by number wins.
- **Claim**: set `Status: claimed` and save **before any work**. The status
  line is the claim; concurrent sessions skip claimed tickets.
- **Resolve**: append the answer under an `## Answer` heading, set
  `Status: resolved`, then add one line to the map's **Decisions so far**:
  `- [<ticket title>](./issues/NN-<slug>.md): <one-line gist>`.
- **Refer by name**: in anything the human reads, use the ticket's title with
  the path as its link — never a bare `NN`.
- **Research assets**: findings produced for a `research` ticket follow the
  `research` skill's own convention (a cited file under the owning
  `docs/research/`), linked from the ticket. Never a throwaway branch — branch
  creation is blocked in this workspace by the git guardrail, deliberately.
