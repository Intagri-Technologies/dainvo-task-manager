---
name: setup-pre-commit
description: Set up a Husky pre-commit hook with lint-staged and typecheck in one repo of this workspace. Use when the user wants pre-commit hooks, Husky, lint-staged, or commit-time formatting/typechecking added to a repo.
---

# Setup Pre-Commit Hooks

Installs, in **one repo at a time**, a pre-commit hook that runs lint-staged on
the staged files and the repo's `typecheck` script.

Two workspace rules override the upstream recipe:

- **No tests in the hook.** `pnpm test` in `dainvo/` is a multi-minute gate on
  a 632k-line repo; a hook that runs it makes every commit intolerable. The
  hook runs lint-staged and `typecheck` only; the full suite stays with CI and
  the pre-release checks.
- **Never introduce a formatter a repo has not opted into.** Only `dainvo/`
  has Prettier (`.prettierrc.json` + the dep). Everywhere else, creating a
  Prettier config — upstream's step 6 — would start reformatting every touched
  file on commit and bury real diffs in noise. Where there is no Prettier,
  lint-staged runs `eslint --fix` if the repo has ESLint, or is omitted.

Ask before installing: a pre-commit hook fires on the **user's own commits**
too, not just agent commits. Confirm the target repo and what the hook will
run, then proceed.

## Per-repo facts (verified 2026-08-19)

| Repo | PM | `typecheck` | Formatter | lint-staged should run |
| --- | --- | --- | --- | --- |
| `dainvo` | pnpm | yes | Prettier 3 | `prettier --write` + `eslint --fix` |
| `dainvo_users` | npm | yes | none | `eslint --fix` |
| `dainvo_admin` | npm | yes | none | `eslint --fix` |
| `dainvo-task-manager` | pnpm | yes | none | `eslint --fix` |
| `dainvo_ai_gateway` | pnpm | yes | none | typecheck only (no lint script) |
| `dainvo-docs` | pnpm | yes | none | typecheck only (no lint script) |
| `booking_page` | npm | yes | none | typecheck only (no lint script) |
| `email_addons` | pnpm | yes | none | per-package `lint` via pnpm filters |
| `dainvo_supabase` | pnpm | **no** | none | not a candidate as-is: no typecheck script; Edge Functions are Deno — ask what the hook should even run |
| `dainvo_web_landing` | npm | **no** | none | not a candidate as-is: no typecheck script |
| `dainvo_mobile` | — | — | — | Flutter: no package.json. A hook would be plain `.git/hooks` running `flutter analyze`; do not install Husky here |
| `payment_site` | — | — | — | static, no package.json: skip |

Re-verify against `package.json` before acting — this table is a snapshot, and
scripts change.

## Steps (for one confirmed repo)

### 1. Detect the package manager

`pnpm-lock.yaml` → pnpm, `package-lock.json` → npm. Use it for every command
below. Do not default: the split above is real and mixing them corrupts
lockfiles.

### 2. Install dependencies

`husky` and `lint-staged` as devDependencies. Add `prettier` **only** in a
repo that already has it (today: none need adding; `dainvo` already has it).

### 3. Initialize Husky

```bash
npx husky init      # or: pnpm exec husky init
```

Creates `.husky/` and adds `"prepare": "husky"` to package.json.

### 4. Write `.husky/pre-commit`

No shebang needed for Husky v9+. Using the detected PM, e.g. for `dainvo`:

```
pnpm exec lint-staged
pnpm typecheck
```

If the repo has no `typecheck` script, stop and ask rather than omitting
silently — the typecheck is the half of this that catches agent mistakes.

### 5. Write the `lint-staged` config

Into `package.json` (keeps the file count down). Match the repo's row above.
For `dainvo`:

```json
"lint-staged": {
  "*.{ts,tsx,mts,mjs,js}": ["eslint --fix --max-warnings=0"],
  "*.{ts,tsx,mts,mjs,js,json,css,md}": ["prettier --write"]
}
```

For an ESLint-only repo, the Prettier line is omitted, not replaced with a new
Prettier setup.

### 6. Verify — the hook must be seen to fire

- [ ] `.husky/pre-commit` exists; `"prepare": "husky"` is in package.json.
- [ ] Stage a file with a deliberate, trivially fixable lint offence and run
      `git commit`: the hook fires, fixes or rejects, and the offence never
      lands. Revert the probe after.
- [ ] Time a normal commit. If typecheck pushes it past ~30s, say so — the
      user may prefer lint-staged only in that repo.

### 7. Commit

Stage **only** the files this setup created or changed — `.husky/`,
`package.json`, the lockfile. Never `git add .`: this workspace routinely
carries uncommitted WIP that is not yours to commit. The commit itself running
through the new hook is the smoke test.

## Notes

- `prettier --ignore-unknown` is only relevant in `dainvo`; elsewhere there is
  no Prettier to guard.
- The workspace's PreToolUse git guardrail is unrelated: it blocks push and
  branch creation before git runs; this hook validates content at commit time.
  They compose.
- Husky's `prepare` script means a plain `pnpm install` / `npm install`
  re-arms the hook for anyone who clones the repo.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT),
`skills/misc/setup-pre-commit`: tests removed from the hook, Prettier is never
introduced where absent, and the per-repo facts table replaces guesswork. The
canonical copy lives at `skills/setup-pre-commit/`; copies under each
project's `.claude/`, `.codex/`, and `.agents/` directories are generated by
`scripts/sync-agent-skills.sh`.
