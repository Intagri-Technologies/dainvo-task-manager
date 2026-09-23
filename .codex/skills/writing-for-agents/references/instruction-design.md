# Instruction design

Use this reference when agents repeatedly miss a rule, stop too early, load
irrelevant material, or do unnecessary work. Start with the observed failure;
change the smallest instruction that could explain it.

## A reference is being missed

Check the trigger before copying the target into the entrypoint. A useful
pointer names both the condition and the material to consult. For example,
"For user-facing string changes, read the localization rules" routes more
precisely than "See the docs."

Use one trigger for each distinct branch. Repeating synonyms increases text
without defining another case. Confirm the target exists and can answer the
question implied by the pointer.

## Too much material is loaded

Separate what every task needs from guidance used by only one branch. Shared
constraints stay visible; substantial branch-specific detail can move behind
a conditional link. Group related rules before splitting files, since scattered
exceptions can look like missing instructions.

Splitting also has a cost: more files to discover, maintain, and navigate.
Prefer one short document when branching adds no useful choice. A lower word
count is not an improvement if it hides the rule responsible for good output.

## Work ends too early

Make completion observable. "Understand the change" gives little guidance;
"Account for each modified API and its caller" defines evidence to collect.
Choose coverage appropriate to the risk instead of requiring exhaustive work
for every task.

Clarify the outcome before adding phases. If later steps consistently distract
from an unresolved decision, consider separating the work. Splitting text into
files alone does not clear material already in context. Delegation is a separate
execution choice, not an automatic consequence of reorganizing documentation.

## Work grows without improving the result

Look for fixed counts, unconditional full-suite checks, repeated reads, mandatory
reports, or open-ended directions such as "keep investigating." Replace each
with the evidence that should trigger it and the condition that ends it.

Use established terms when they remove repetition, but spell out the action
when a compact label would become vague. Preserve hard safety constraints and
quality guidance supported by experience. Remove redundant explanations and
unsupported rules first.

Validate against the failure that prompted the edit and a routine case that
should remain cheap. Behavioral evaluation is useful when routing is uncertain;
ordinary wording edits need only focused review and document validation.
