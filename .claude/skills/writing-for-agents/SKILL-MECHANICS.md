# Skill mechanics

Consult this reference when changing discovery, invocation, metadata, or skill
structure. Use the current host's skill-creation guidance for supported fields;
frameworks do not necessarily interpret invocation settings the same way.

## Discovery and invocation

Keep the name stable unless a rename is requested or needed. Describe the actual
capability and the distinct tasks that should select it. Add an exclusion only
when it prevents likely misrouting.

Preserve existing invocation policy. For Codex, skill-creator guidance keeps
automatic selection enabled unless the user requests an explicit-only skill.
Do not disable discovery merely to reduce context or because the workflow has
sensitive actions. Invocation does not authorize those actions.

When editing Codex UI metadata or policy, consult the available skill-creator
`references/openai_yaml.md`; preserve unrelated fields in `agents/openai.yaml`.
Keep UI descriptions consistent with the skill's actual behavior. Avoid promises
of zero context cost based solely on an invocation flag.

## Structure and validation

A skill needs `SKILL.md` with valid name and description frontmatter. Add a
reference, script, asset, or router only when a concrete use justifies it.
A router should identify which branch to follow without loading every branch.
Create separate skills only for independently useful invocation cases; shared
reference material does not need its own skill.

Run the available skill validator after changing the skill. Check affected
relative links and metadata consistency. Run changed executable helpers when
safe; documentation-only edits do not require application builds.
