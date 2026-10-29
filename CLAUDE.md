# Repository instructions

<!-- BEGIN managed-git-policy -->
## Branch and worktree names

Use the same working-branch names locally and on GitHub:

- `feat/<topic>` for new features.
- `hotfix/<topic>` for bugs and fixes. Use `hotfix/`, never `fix/`.
- `develop/<topic>` for general development, refactors, documentation, release
  preparation, and recovery snapshots.

Use lowercase kebab-case topics that describe the work. Never use `codex/`,
`agent/`, `claude/`, or another assistant/tool identity as a branch prefix.
Keep the repository's default branch, tags, and provider-managed dependency PR
branches intact. Do not turn release tags into working branches.

For project-managed worktrees, use `<repo>.worktrees/<type>/<topic>` with the
same `feat`, `hotfix`, or `develop` type as the branch. Give detached work a
conforming branch before committing. Tool-managed storage paths are not branch
names; use the tool's supported controls rather than editing its private state.

Work on the current branch unless the task calls for another branch or
worktree. A naming rule alone does not authorize a rename or cleanup. A direct
request to organize branches or worktrees authorizes that work without another
confirmation. Honor exclusions, preserve local edits, and do not bypass a
rejected Git guard command.

Before cleanup, fetch and inspect branch tips, upstreams, open PRs, and worktree
ownership. Delete a stale branch only when its tip is an ancestor of the
default branch and no worktree or open PR needs it. Preserve unmerged work by
renaming its existing branch without changing its tip. Check for destination
collisions; never force a branch rename, rewrite history, or discard files.
Preserve worktree locks and working files when moving a worktree, and keep
existing path references working. An "ahead" count against an old upstream is
not evidence that work is missing from the default branch.
<!-- END managed-git-policy -->
