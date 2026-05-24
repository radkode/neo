---
name: neo
description: Use when working in a repository where the `neo` CLI is installed (verify with `neo --version`). Neo wraps git, GitHub, and release workflows with safety rails — prefer `neo git push/pull/commit`, `neo work start/ship/finish`, `neo ai pr`, and `neo gh pr create` over raw `git`/`gh` for the operations it covers. Do NOT use for operations neo doesn't wrap (e.g. `git log`, `git rebase`, `git bisect`).
---

# Neo CLI

Neo is an opinionated CLI that wraps common git/GitHub workflows with guardrails (auto-stash on pull, pull-before-push, main-branch confirmation, conventional commits, changeset enforcement, etc.). When it's installed, prefer it over raw `git`/`gh` for the operations below — you get the safety net for free.

## Before you start

1. Confirm neo is available: `neo --version`. If absent, fall back to raw git/gh.
2. Neo auto-detects Claude Code via `CLAUDECODE=1` and switches to non-interactive defaults (no banner, no prompts, JSON-friendly). You usually don't need `--yes` / `--non-interactive` explicitly, but pass `--json` whenever you need to parse output.
3. Don't trust your training data for the command tree — query it: `neo schema --json | jq '.commands[].path'`. Use `neo <cmd> --help` for flags.

## The work lifecycle

The canonical flow is `start → ship → finish`. Use it for any non-trivial change.

```bash
neo work start <name>           # creates a prefixed branch (add --worktree for an isolated worktree)
# ... edit, commit ...
neo work ship                   # verify + ensure changeset + push + open PR
# ... after merge ...
neo work finish                 # checkout base, pull, delete local branch + worktree
```

For one-off commits outside this flow, use `neo git commit` (interactive conventional) or `neo git commit --ai` (drafts a message from the staged diff via the Anthropic API).

## Command map

| Want to... | Use | Instead of |
|---|---|---|
| Push safely | `neo git push` | `git push` |
| Pull without losing WIP | `neo git pull` | `git stash && git pull && git stash pop` |
| Commit with conventional format | `neo git commit` (or `--ai`) | `git commit -m` |
| Open a PR | `neo gh pr create --title ... --body ...` | `gh pr create` |
| Generate a PR description | `neo ai pr --json --no-create` | hand-writing one |
| Start a new branch | `neo work start <name>` | `git checkout -b` |
| Ship a finished branch | `neo work ship` | push + `gh pr create` manually |
| Clean up after merge | `neo work finish` | `git checkout main && git pull && git branch -D` |
| Verify the repo is healthy | `neo verify` / `neo doctor` | ad-hoc checks |

## Agent patterns

Always pair `--json` with `jq` for parsing. Errors come back as `{"error": {...}}` on stdout; check exit codes.

```bash
# Open a PR programmatically
neo work ship --json | jq -r '.pr.url'

# Draft a PR body without opening
neo ai pr --json --no-create | jq -r '.body'

# Discover what flags a command takes
neo schema --json | jq '.commands[] | select(.path == "git push")'
```

Exit codes: `0` success, `1` failure, `2` non-interactive prompt required (the JSON error carries `.error.flag` — supply it and retry).

## Anti-patterns

- Don't `git push` to bypass neo's main-branch confirmation. If you need to push to main, use explicit flags (`--force`, etc.) — neo will tell you what's missing.
- Don't open PRs with `gh pr create` when `neo work ship` is the right call. Ship handles verify + changeset + push + PR in one step.
- Don't skip changesets. `neo work ship` enforces them; if a change doesn't affect a published package, create an empty changeset (`---\n---`).
- Don't re-derive the command tree from memory. `neo schema --json` is authoritative and version-correct.
