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

| Friction | Neo's Solution |
|----------|----------------|
| Accidentally pushing to `main` | Interactive confirmation before main branch pushes |
| Forgetting to pull before pushing | `neo git push` pulls first, then pushes |
| Typing `git stash && git pull && git stash pop` | `neo git pull` handles it automatically |
| Managing scattered config files | Unified `neo config` with secure secrets storage |

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

Pulls before pushing. Prompts for confirmation on `main`.

```bash
neo git push              # Safe push (confirms on main)
neo git push --force      # Force push
neo git push --tags       # Include tags
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

| Flag | What it does |
|------|--------------|
| `--json` | Emit a single JSON payload on stdout. Implies `--non-interactive` and `--quiet`. Errors come back as `{"error": {...}}`. |
| `-y, --yes` | Auto-accept prompt defaults. Safe for idempotent operations; destructive actions still require an explicit flag like `--force`. |
| `--non-interactive` | Fail fast with exit code `2` instead of prompting. Pair with `--yes` or the prompt-specific flag. |
| `-q, --quiet` | Suppress banner, spinners, and decorative output. |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Command failure (see stderr/JSON error for details) |
| `2` | Non-interactive prompt required — pass the missing flag |

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

## License

[MIT](LICENSE) © Jacek Radko
