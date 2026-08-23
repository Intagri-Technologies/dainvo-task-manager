#!/usr/bin/env bash
#
# PreToolUse Bash hook: refuse git commands that change branch topology or
# destroy uncommitted work.
#
# Push authorization belongs to the agent instructions because this hook cannot
# inspect the conversation. A direct user request authorizes a push. This hook
# still protects branch topology and uncommitted work.
#
# Reads the hook payload on stdin, writes a permissionDecision on stdout.
# Exits 0 whether it allows or denies — the decision travels in the JSON.
#
# Canonical copy: scripts/hooks/block-dangerous-git.sh
# Generated copies: <project>/.claude/hooks/ and <project>/.codex/hooks/
# Edit the canonical copy, then run scripts/sync-agent-skills.sh.

set -uo pipefail

INPUT=$(cat)

if command -v jq >/dev/null 2>&1; then
  COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  # jq missing: fail open rather than blocking every command in the session.
  exit 0
fi

[[ -z "$COMMAND" ]] && exit 0

deny() {
  local what="$1" fix="$2"
  jq -nc --arg r "Blocked: $what

$fix

This workspace protects branch topology and uncommitted work. Use the branch
that is already checked out and preserve the user's files." '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# Split the command line into segments so `foo && git reset --hard` is still
# inspected.
# Newlines, ;, &&, ||, |, and & all start a new segment.
SEGMENTS=$(printf '%s' "$COMMAND" \
  | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g; s/|/\n/g; s/&/\n/g')

while IFS= read -r segment; do
  # shellcheck disable=SC2206
  read -ra words <<<"$segment" || continue
  [[ ${#words[@]} -eq 0 ]] && continue

  i=0
  # Skip leading env assignments (FOO=bar git ...) and sudo.
  while [[ $i -lt ${#words[@]} ]]; do
    case "${words[$i]}" in
      *=*) ((i++)) ;;
      sudo|command|env) ((i++)) ;;
      *) break ;;
    esac
  done

  # Must be a git invocation.
  [[ "${words[$i]:-}" != "git" ]] && continue
  ((i++))

  # Skip git's global options, including the ones that consume a value.
  # This is what makes `git -C dainvo reset --hard` match.
  while [[ $i -lt ${#words[@]} ]]; do
    case "${words[$i]}" in
      -C|-c|--exec-path|--git-dir|--work-tree|--namespace) ((i += 2)) ;;
      --exec-path=*|--git-dir=*|--work-tree=*|--namespace=*|--no-pager|--paginate|--bare|--literal-pathspecs|--no-replace-objects) ((i++)) ;;
      -*) ((i++)) ;;
      *) break ;;
    esac
  done

  sub="${words[$i]:-}"
  [[ -z "$sub" ]] && continue
  args=("${words[@]:$((i + 1))}")

  case "$sub" in
    reset)
      for a in "${args[@]:-}"; do
        [[ "$a" == "--hard" ]] && \
          deny "\`$COMMAND\`" "\`git reset --hard\` discards uncommitted work. Use \`git stash\` if you need a clean tree."
      done
      ;;

    clean)
      for a in "${args[@]:-}"; do
        # -f, -fd, -xdf, --force all mean "delete untracked files".
        [[ "$a" == "--force" || "$a" =~ ^-[a-eg-zA-Z]*f ]] && \
          deny "\`$COMMAND\`" "\`git clean\` permanently deletes untracked files. List them with \`git clean -n\` and let the user decide."
      done
      ;;

    checkout)
      for a in "${args[@]:-}"; do
        [[ "$a" == "-b" || "$a" == "-B" ]] && \
          deny "\`$COMMAND\`" "Creating a branch needs the user's explicit permission. Work on the branch already checked out."
        [[ "$a" == "." ]] && \
          deny "\`$COMMAND\`" "\`git checkout .\` discards every uncommitted change. Use \`git stash\` instead."
      done
      ;;

    switch)
      for a in "${args[@]:-}"; do
        [[ "$a" == "-c" || "$a" == "-C" || "$a" == "--create" || "$a" == "--force-create" ]] && \
          deny "\`$COMMAND\`" "Creating a branch needs the user's explicit permission. Work on the branch already checked out."
      done
      ;;

    restore)
      staged=0
      for a in "${args[@]:-}"; do
        [[ "$a" == "--staged" ]] && staged=1
      done
      if [[ $staged -eq 0 ]]; then
        for a in "${args[@]:-}"; do
          [[ "$a" == "." ]] && \
            deny "\`$COMMAND\`" "\`git restore .\` discards every uncommitted change. Use \`git stash\` instead."
        done
      fi
      ;;

    branch)
      listing=0
      positional=0
      destructive=0
      for a in "${args[@]:-}"; do
        case "$a" in
          "")
            # Empty-array expansion, not a real argument.
            ;;
          -l|--list|-a|--all|-r|--remotes|-v|-vv|--verbose|--show-current|--contains|--merged|--no-merged|--sort=*|--format=*|--color*|-q|--quiet)
            listing=1 ;;
          -d|-D|--delete|-m|-M|--move|-c|-C|--copy)
            destructive=1 ;;
          -*) ;;
          *) ((positional++)) ;;
        esac
      done
      if [[ $destructive -eq 1 ]]; then
        deny "\`$COMMAND\`" "Deleting or renaming a branch needs the user's explicit permission."
      fi
      # `git branch <name>` with no listing flag creates a branch.
      if [[ $listing -eq 0 && $positional -gt 0 ]]; then
        deny "\`$COMMAND\`" "Creating a branch needs the user's explicit permission. Work on the branch already checked out."
      fi
      ;;

    worktree)
      if [[ "${args[0]:-}" == "add" ]]; then
        for a in "${args[@]:-}"; do
          [[ "$a" == "-b" || "$a" == "-B" ]] && \
            deny "\`$COMMAND\`" "That creates a branch. Adding a worktree on an existing branch is fine; creating one is the user's call."
        done
      fi
      ;;
  esac
done <<<"$SEGMENTS"

exit 0
