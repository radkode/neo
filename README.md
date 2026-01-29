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

### `neo config`

Key-value configuration with secure secrets storage.

```bash
neo config set key value  # Set a value
neo config get key        # Get a value
neo config list           # List all values
```

### `neo update`

Self-update with your detected package manager.

```bash
neo update                # Update to latest
neo update --check-only   # Check for updates
```

## Global Options

```
-v, --verbose     Verbose output
--no-color        Disable colors
--no-banner       Hide banner
-h, --help        Show help
-V, --version     Show version
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
