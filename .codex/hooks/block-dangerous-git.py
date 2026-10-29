#!/usr/bin/env python3
"""Guard direct Git shell commands. Consent and open PR checks remain agent rules.

This is a command guard, not a sandbox for arbitrary programs invoking Git.
"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

BRANCH = re.compile(r"(?:feat|hotfix|develop)/[a-z0-9]+(?:-[a-z0-9]+)*\Z")


def inspect(command: str, cwd: str) -> str | None:
    lexer = shlex.shlex(io.StringIO(command), posix=True, punctuation_chars=";&|()\n")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    try:
        tokens = list(lexer)
    except ValueError:
        return "Cannot parse the shell command. Use a plain Git command."
    segments = [[]]
    for token in tokens:
        if token and all(c in ";&|()\n" for c in token):
            segments.append([])
        else:
            segments[-1].append(token)
    for words in segments:
        while words and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", words[0]) or words[0] in {"command", "env", "sudo"}):
            words = words[1:]
        if not words:
            continue
        if words[0] == "cd" and len(words) == 2:
            cwd = os.path.abspath(os.path.join(cwd, os.path.expanduser(words[1])))
            continue
        if Path(words[0]).name in {"bash", "sh", "zsh"} and len(words) >= 3 and words[1] in {"-c", "-lc"}:
            reason = inspect(words[2], cwd)
            if reason:
                return reason
            continue
        if Path(words[0]).name != "git":
            continue
        index = 1
        while index < len(words) and words[index].startswith("-"):
            index += 2 if words[index] in {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"} else 1
        if index >= len(words):
            continue
        prefix, sub, args = words[:index], words[index], words[index + 1:]
        if sub == "branch":
            expanded = []
            for argument in args:
                if re.fullmatch(r"-[dDmMcCfr]+", argument):
                    expanded.extend("-" + flag for flag in argument[1:])
                else:
                    expanded.append(argument)
            args = expanded

        def git(*arguments):
            return subprocess.run(prefix + list(arguments), cwd=cwd, text=True, capture_output=True)

        def default_ref():
            remote = git("symbolic-ref", "--quiet", "refs/remotes/origin/HEAD").stdout.strip()
            candidates = [remote, "refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main", "refs/heads/master"]
            return next((ref for ref in candidates if ref and git("rev-parse", "--verify", ref).returncode == 0), None)

        def protected(name):
            default = default_ref()
            return name in {"main", "master"} or (default and name == default.removeprefix("refs/remotes/origin/").removeprefix("refs/heads/"))

        def name_error(name):
            if not BRANCH.fullmatch(name):
                return "Use feat/<topic>, hotfix/<topic>, or develop/<topic> with a lowercase kebab-case topic."
            return None

        if sub == "reset" and "--hard" in args:
            return "git reset --hard discards working files."
        if sub == "clean" and any(a == "--force" or (a.startswith("-") and not a.startswith("--") and "f" in a) for a in args):
            return "Forced git clean deletes untracked files. Inspect them with git clean -n."
        if sub in {"checkout", "switch"}:
            if any(a in {"-f", "--force", "--discard-changes", "-B", "-C", "--force-create"} or a.startswith(("--force-create=", "-B", "-C")) or re.fullmatch(r"-[fmq]+", a) and "f" in a for a in args):
                return "Force checkout/switch can overwrite a branch or working files."
            if sub == "checkout" and "." in args:
                return "git checkout . discards working files."
            for i, a in enumerate(args):
                name = None
                if a in {"-b", "-c", "--create", "--orphan"}:
                    name = args[i + 1] if i + 1 < len(args) else ""
                elif a.startswith(("--create=", "--orphan=")):
                    name = a.split("=", 1)[1]
                elif len(a) > 2 and a[:2] in {"-b", "-c"}:
                    name = a[2:]
                if name is not None and name_error(name):
                    return name_error(name)
        if sub == "restore" and "." in args and ("--staged" not in args or "--worktree" in args):
            return "git restore . discards working files."
        if sub == "branch":
            if any(a in {"-D", "-M", "-C", "-f", "--force"} for a in args):
                return "Force branch deletion, rename, copy, and replacement are blocked."
            if any(a in {"-d", "--delete"} for a in args):
                names = [a for a in args if not a.startswith("-")]
                default = default_ref()
                if not names or default is None:
                    return "Cannot verify deletion against the repository's default branch."
                worktrees = git("worktree", "list", "--porcelain").stdout.splitlines()
                for name in names:
                    if protected(name):
                        return "The default branch cannot be deleted."
                    ref = "refs/heads/" + name
                    if "branch " + ref in worktrees:
                        return "A worktree still uses this branch. Preserve it until the worktree is retired."
                    if git("merge-base", "--is-ancestor", ref, default).returncode != 0:
                        return "This branch has work outside the default branch. Rename it instead of deleting it."
                continue
            if any(a in {"-m", "--move", "-c", "--copy"} for a in args):
                names = [a for a in args if not a.startswith("-")]
                if not names:
                    return "A destination branch is required."
                if name_error(names[-1]):
                    return name_error(names[-1])
                old = names[0] if len(names) > 1 else git("branch", "--show-current").stdout.strip()
                if protected(old):
                    return "The default branch cannot be renamed or copied as a working branch."
                continue
            if any(a == "--unset-upstream" or a.startswith(("--set-upstream-to", "--edit-description")) for a in args) or "-u" in args:
                continue
            listing = any(a in {"--list", "-l", "-a", "--all", "-r", "--remotes", "--show-current", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at"} or a.startswith(("--format=", "--contains=", "--merged=", "--no-merged=", "--points-at=")) for a in args)
            names = [a for a in args if not a.startswith("-")]
            if names and not listing and name_error(names[0]):
                return name_error(names[0])
        if sub == "push":
            if any(a == "--mirror" or a.startswith(("--force", "+")) or re.fullmatch(r"-[a-zA-Z]+", a) and "f" in a for a in args):
                return "Force pushes and mirrored pushes can rewrite or delete remote history."
            for a in args:
                destination = a.rsplit(":", 1)[-1].removeprefix("refs/heads/")
                if destination.startswith(("codex/", "agent/", "claude/")):
                    return "Rename assistant-prefixed branches before publishing them."
        if sub == "worktree" and args:
            if args[0] in {"remove", "add"} and any(a in {"-f", "--force", "-B"} for a in args):
                return "Force worktree removal or replacement can discard working files."
            if args[0] == "add":
                for i, a in enumerate(args):
                    if a == "-b" and name_error(args[i + 1] if i + 1 < len(args) else ""):
                        return name_error(args[i + 1] if i + 1 < len(args) else "")
            # Git requires move --force to move a locked worktree while
            # preserving its existing lock. It does not overwrite files.
    return None


def main():
    payload = json.load(sys.stdin)
    tool_input = payload.get("tool_input", {})
    command = tool_input.get("command", tool_input.get("cmd", ""))
    cwd = tool_input.get("workdir") or payload.get("cwd") or os.getcwd()
    reason = inspect(command, cwd) if command else None
    if reason:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Blocked: " + reason}}))


if __name__ == "__main__":
    main()
