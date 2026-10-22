<div align="center">

# Neo CLI

**An opinionated CLI that wraps common commands to smooth out paper cuts and speed up your workflow.**

[![npm version](https://img.shields.io/npm/v/@radkode/neo.svg)](https://www.npmjs.com/package/@radkode/neo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/radkode/neo/workflows/CI/badge.svg)](https://github.com/radkode/neo/actions)

</div>

---

## Why Neo?

Daily CLI workflows have friction. Neo wraps familiar commands with sensible defaults and guardrails:

| Friction                                        | Neo's Solution                                     |
| ----------------------------------------------- | -------------------------------------------------- |
| Accidentally pushing to `main`                  | Interactive confirmation before main branch pushes |
| Forgetting to pull before pushing               | `neo git push` pulls first, then pushes            |
| Typing `git stash && git pull && git stash pop` | `neo git pull` handles it automatically            |
| Managing scattered config files                 | Unified `neo config` with secure secrets storage   |

Neo doesn't replace your tools—it wraps them with opinions that prevent mistakes and save keystrokes.

## Install

```bash
npm install -g @radkode/neo
# or
pnpm add -g @radkode/neo
```

## Quick Start

```bash
neo --help          # See all commands
neo git push        # Smart push with main branch protection
neo git pull        # Auto-stash, pull, pop
neo config list     # View your configuration
```

## Commands

### `neo git push`

Guards protected branches by where a push lands, not by the branch you have checked out. Protected means the remote's default branch (from `<remote>/HEAD`) plus `main` and `master`. Neo reads every refspec before pushing, so `HEAD:main` from a feature branch is caught, and deleting an unrelated branch from a `main` checkout is not.

- Updating a protected branch asks for confirmation. `--allow-main` authorizes it, and `git config neo.allowMainPush true` lets a checkout whose working branch is `main` push without either.
- Force-pushing or deleting a protected branch, and pushes neo cannot fully resolve (`--mirror`, `--all`, `--prune`, wildcard refspecs, `remote.<name>.push` mappings), always need `--allow-main` or a confirmation. `neo.allowMainPush` does not cover them, including a force-push chosen after a rejected push.
- `--dry-run` reports each destination the given remote and refspecs would change, the commits it would send, and whether a real push would need authorization.

When a push is rejected as non-fast-forward, neo offers to pull with rebase and retry, force-push, or cancel (`--on-reject` picks without a prompt). The first push of a branch with no upstream sets one to the same-named remote branch, as `git push -u` would. A branch that still tracks the remote's default branch (as `git checkout -b x origin/main` leaves it) is retargeted the same way; tracking a different remote (a fork workflow) or another feature branch (a stack) is left alone.

```bash
neo git push                          # Push the current branch (confirms on a protected one)
neo git push origin HEAD:main         # Guarded: lands on main
neo git push --allow-main             # Push to a protected branch on purpose
neo git push --dry-run origin a:b     # Show what this exact push would change
neo git push --force                  # Force-push a feature branch (unguarded)
git config neo.allowMainPush true     # This checkout pushes main directly
```

### `neo git pull`

Stashes uncommitted changes, pulls, and restores your work.

```bash
neo git pull              # Auto-stash and pull
neo git pull --rebase     # Pull with rebase
```

### `neo git stash`

Simplified stash management.

```bash
neo git stash             # Stash changes
neo git stash pop         # Pop latest stash
neo git stash list        # List stashes
```

### `neo git commit`

Conventional commits with optional AI-drafted messages.

```bash
neo git commit            # Interactive conventional commit
neo git commit --ai       # Draft a message from the staged diff (Anthropic API)
```

The AI path uses `claude-haiku-4-5` by default and caches the system prompt. Set your key with `neo config set ai.apiKey` or `ANTHROPIC_API_KEY`.

### `neo verify`

Runs the `build`, `test`, `lint`, and `typecheck` package scripts that the repository defines. A repository can select one shared verification gate in `package.json`:

```json
{
  "scripts": {
    "build:restricted": "next build --webpack",
    "verify:neo": "pnpm run build:restricted && pnpm run quality:check"
  },
  "neo": {
    "verify": "verify:neo"
  }
}
```

Neo invokes the configured value as a package script. Use an umbrella script when verification needs multiple commands or environment-specific options. `neo verify --only build,test` overrides the repository setting for one run, and `--skip` filters the selected scripts.

### `neo gh pr status`

Shows whether a pull request can merge: its checks, review decision, unresolved review threads, and mergeability, reduced to one verdict (`ready`, `pending`, `failing`, `conflicting`, `blocked`, `merged`, or `closed`) with the reasons behind it. When branch protection requires checks, only those decide the verdict; otherwise every check does.

```bash
neo gh pr status                  # The current branch's PR
neo gh pr status 88 --json        # Full report, including headRefOid
neo gh pr status 88 --wait        # Poll until checks settle (every 15s, up to 30 min)
```

Without `--wait` the command exits `0` whenever it can read the PR. With `--wait` it exits `0` only when the PR is `ready` or `merged`, so it chains into a merge. Pass the inspected head to `neo gh pr merge --head`, and the merge is refused if anyone pushes after you looked:

```bash
head=$(neo gh pr status 88 --wait --json | jq -r .headRefOid) &&
  neo gh pr merge 88 --strategy squash --head "$head"
```

Right after a push, GitHub can take a moment to register checks, so `--wait` treats a PR with no checks as pending for its first minute.

### `neo pnpm`

Runs pnpm with the nearest `.env.pnpm.local` loaded only into pnpm and its subprocesses. Discovery walks upward from the current directory but stops at the nearest Git repository or worktree root. Outside a Git repository, only the current directory is checked. No file means normal pnpm execution; `.env.local` is not loaded.

Keep `.env.pnpm.local` untracked: add it to the repository's ignore rules or your local Git exclude file, and restrict its permissions with `chmod 600 .env.pnpm.local`. For example, its contents can be:

```dotenv
GITHUB_TOKEN=your-package-access-token
HARNESS_TOKEN=your-harness-token
```

```bash
neo pnpm -- install --frozen-lockfile
neo pnpm -- run dev
neo pnpm --env-file /path/to/private.env -- install  # Explicit override

neo alias setup --pnpm  # Opt in once; backs up ~/.zshrc and checks conflicts
                        # (or opt in while installing: neo init --pnpm)
source ~/.zshrc
pnpm install           # Automatically loads this repository's .env.pnpm.local
pnpm run dev
command pnpm install   # Bypass the alias and environment loading
```

The alias is `pnpm="neo --quiet pnpm --"`, so pnpm flags are forwarded unchanged and repositories without a convention file keep working normally. The wrapper invokes the pnpm executable directly, without shell alias recursion. File values override inherited variables for the child only, with no variable interpolation. It does not export tokens to your shell or affect separate `gh` commands. Remove any previous global token exports yourself; the wrapper cannot remove them from its parent shell.

`neo init` also offers the pnpm and yarn aliases, preselecting whichever ones `~/.zshrc` already has. Pass `--pnpm`/`--yarn` to add them or `--no-pnpm`/`--no-yarn` to remove them without the prompt; with `--yes` or `--non-interactive`, init keeps the current aliases.

### `neo yarn`

Works like `neo pnpm`, for Yarn: runs Yarn with the nearest `.env.yarn.local` loaded only into Yarn and its subprocesses. Discovery, the `--env-file` override, and the file rules are the same as for `neo pnpm`. It does not read `.env.pnpm.local`; to reuse a file from another repository, pass it with `--env-file`. Keep `.env.yarn.local` untracked and restrict its permissions with `chmod 600 .env.yarn.local`.

```bash
neo yarn -- install --immutable
neo yarn --env-file /path/to/private.env -- install  # Explicit override

neo alias setup --yarn  # Opt in once; combine with --pnpm to alias both
                        # (or opt in while installing: neo init --yarn)
source ~/.zshrc
yarn install           # Automatically loads this repository's .env.yarn.local
command yarn install   # Bypass the alias and environment loading
```

The alias is `yarn="neo --quiet yarn --"`. Yarn reads the variables the same way it reads exported ones, so a `.yarnrc.yml` entry such as `npmAuthToken: "${GITHUB_TOKEN}"` works unchanged.

### `neo config`

Key-value configuration with secure secrets storage and profiles.

```bash
neo config set key value         # Set a value
neo config get key               # Get a value
neo config list                  # List all values
neo config profile create work   # Create/switch profiles
```

### `neo update`

Self-update with your detected package manager.

```bash
neo update                # Update to latest
neo update --check-only   # Check for updates
```

## Agent mode

Neo is built to be scripted and driven by AI coding agents (Claude Code, Cursor, Aider, etc.). Every command returns structured output on demand, has deterministic exit codes, and can skip prompts — no screen-scraping required.

### Flags

| Flag                | What it does                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--json`            | Emit a single JSON payload on stdout. Implies `--non-interactive` and `--quiet`. Errors come back as `{"error": {...}}`.        |
| `-y, --yes`         | Auto-accept prompt defaults. Safe for idempotent operations; destructive actions still require an explicit flag like `--force`. |
| `--non-interactive` | Fail fast with exit code `2` instead of prompting. Pair with `--yes` or the prompt-specific flag.                               |
| `-q, --quiet`       | Suppress banner, spinners, and decorative output.                                                                               |

### Exit codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| `0`  | Success                                                 |
| `1`  | Command failure (see stderr/JSON error for details)     |
| `2`  | Non-interactive prompt required — pass the missing flag |

### Environment markers

Neo auto-detects agent environments and switches to agent defaults (no banner, no color, non-interactive):

- `CLAUDECODE=1` — Claude Code
- `CURSOR_AGENT=1` — Cursor agent
- `AIDER=1` — Aider
- `NEO_AGENT=1` — any other agent

Override flags: `NEO_JSON`, `NEO_YES`, `NEO_NON_INTERACTIVE`, `NEO_QUIET`. `NO_COLOR` and `CI` are also respected.

### Discover the command tree

Rather than relying on training data, agents should query Neo's schema directly:

```bash
neo schema                     # Compact JSON on stdout
neo schema --pretty            # Pretty-printed JSON
neo schema --markdown          # Human-readable docs
neo schema | jq '.commands[] | .path'
```

The schema follows an OpenCLI-lite shape: every command, option, argument, and global flag is enumerated with types and descriptions.

### Example: create a PR from an agent

```bash
neo git push --yes --json \
  && neo gh pr create --title "Add X" --body "…" --yes --json \
  | jq -r '.url'
```

### Example: merge once CI is green

```bash
head=$(neo gh pr status 88 --wait --json | jq -r .headRefOid) &&
  neo gh pr merge 88 --strategy squash --head "$head" --yes --json
```

If a required prompt can't be answered non-interactively you'll get exit code `2` and a structured error telling you which flag was missing.

## Global Options

```
-v, --verbose            Verbose output
-c, --config <path>      Path to config file
--no-color               Disable colors
--no-banner              Hide banner
--json                   Machine-readable JSON on stdout (implies --non-interactive, --quiet)
-y, --yes                Auto-accept prompt defaults
--non-interactive        Fail fast instead of prompting
-q, --quiet              Suppress banner and decorative output
-h, --help               Show help
-V, --version            Show version
```

## Development

```bash
git clone https://github.com/radkode/neo.git
cd neo
pnpm install
pnpm run build
pnpm test

# Local testing
pnpm run link-local
neo --help
pnpm run unlink-local
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

## Releases

Changesets opens a version-bump PR. After it merges, the release workflow publishes to npm using trusted publishing, then creates a `v<version>` tag and GitHub Release at the publishing commit with generated release notes. Rerun the failed workflow on that same commit if GitHub release creation fails after npm publication; the package will not be published again. Existing historical versions are not backfilled.

## License

[MIT](LICENSE) © Jacek Radko
