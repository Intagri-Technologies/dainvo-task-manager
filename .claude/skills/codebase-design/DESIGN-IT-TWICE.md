# Compare interface designs

Use when the user requests alternatives or competing interface shapes expose
a consequential tradeoff. Use the vocabulary in [SKILL.md](SKILL.md); reuse it
from context rather than rereading it.

## Frame the choice

Inspect the relevant implementation and callers. Identify the required behavior,
constraints, dependencies, and what would make a design better. Read
[DEEPENING.md](DEEPENING.md) only when dependency strategy is part of the choice.
A small usage sketch can clarify constraints; a separate preliminary report
is unnecessary unless it helps the user decide.

## Explore distinct options

Compare locally by default. Use independent agents when requested or when
independent exploration would materially help and useful work can continue
locally. Delegate bounded design questions, with no fixed minimum agent count.

Give each agent the relevant files, shared constraints, domain terms, and the
specific tradeoff to investigate. Useful alternatives might minimize caller
knowledge, simplify the common case, or accommodate a demonstrated variation.
Avoid speculative extensibility and near-identical proposals.

For each viable option, capture only what is needed to compare:

- Interface, including invariants, ordering, and errors.
- A representative caller example.
- Complexity hidden inside the implementation.
- Dependency and adapter strategy, with its costs.

## Recommend

Compare depth, locality, seam placement, and migration cost. Recommend the
strongest option and explain the tradeoff. Combine elements only when that
improves the design. Stop when the comparison supports a decision; additional
variants should resolve a remaining question, not satisfy a quota.

This reference authorizes design exploration, not implementation beyond the
user's requested scope.
