# Agent Instructions

## Use neo, not raw git

This repo ships `neo`, so it is the last place that should reach past it. `neo git pull` and `neo git push` carry the guardrails (auto-rebase on divergence, the main-branch safety prompt, non-fast-forward resolution) that raw `git pull` and `git push` do not, and the skill neo distributes lists raw git as an anti-pattern. Use `neo git pull --rebase`, `neo git push`, and `neo git push --force-main` when a main-branch push is genuinely intended. `git status` and other read-only commands are fine as-is.

When testing a change to the CLI itself, run the locally linked build (`pnpm run link-local`) so you are exercising your edit rather than the published version.

## Session Completion (Landing the Plane)

When the user has asked you to land the work, finish the job rather than stopping at "ready to push":

1. **Run quality gates** (if code changed): tests, linters, builds.
2. **Land it.** For anything non-trivial use `neo work ship`, which branches, adds the changeset, and opens the PR. For a direct push:
   ```bash
   neo git pull --rebase
   neo git push
   git status  # expect "up to date with origin"
   ```
3. **Clean up.** Prune remote branches. Do not `git stash clear`: it is irreversible, and `neo git pull` auto-stashes, so a pull whose pop failed can leave real work in the stash.
4. **Verify.** Changes committed and pushed.
5. **Hand off.** Context for the next session.

**Rules:**

- Do not leave work the user asked you to land stranded locally. If a push fails, resolve it rather than reporting done.
- Committing and pushing is on request, not automatic. Absent that ask, stop with the work committed and say so. (This is the owner's standing rule across every repo; the older "you MUST always push" wording here contradicted it.)

## When neo itself is wrong

Do not quietly fall back to raw `git` or `gh` when neo misbehaves. That fallback is why a defect in this CLI can survive for months: it stops being felt. A rejected valid input, a guardrail that misfires, a missing command or flag, a stale doc example, or just an idea for making a command better all count.

File it first, then the workaround is fine: dailydeck MCP `create-task`, `intake: "filed"`, `repo: "radkode/neo"`. One thin task, symptom plus the exact command you ran plus fix direction, skim the board first so one defect does not become two, and say in chat that you filed it. A finding about a different tool we own routes to that tool's repo instead (`jacekradko/dailydeck` for DailyDeck, `jacekradko/ai-toolkit` for the Claude Code harness).

## Project Context

- **Package Manager**: pnpm
- **Build**: TypeScript
