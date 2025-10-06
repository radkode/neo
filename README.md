```
  ███╗   ██╗███████╗ ██████╗     ██████╗██╗     ██╗
  ████╗  ██║██╔════╝██╔═══██╗   ██╔════╝██║     ██║
  ██╔██╗ ██║█████╗  ██║   ██║   ██║     ██║     ██║
  ██║╚██╗██║██╔══╝  ██║   ██║   ██║     ██║     ██║
  ██║ ╚████║███████╗╚██████╔╝   ╚██████╗███████╗██║
  ╚═╝  ╚═══╝╚══════╝ ╚═════╝     ╚═════╝╚══════╝╚═╝
```

<div align="center">

### Modern CLI toolkit with intelligent git workflows and configuration management

[![npm version](https://img.shields.io/npm/v/@radkode/neo.svg)](https://www.npmjs.com/package/@radkode/neo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/radkode/neo/workflows/CI/badge.svg)](https://github.com/radkode/neo/actions)

Intelligent git operations • Configuration management • Self-updating

</div>

---

## Features

✨ **Smart Git Operations** - Enhanced git commands with safety confirmations  
⚙️ **Configuration Management** - Simple key-value configuration storage  
🛡️ **Branch Protection** - Interactive confirmation for main branch pushes  
🔄 **Self-Updating** - Built-in update command with smart package manager detection  
🎨 **Beautiful UI** - Colorful output with progress indicators and banners  
📦 **Semantic Versioning** - Automated releases with changesets  
🚀 **TypeScript First** - Built with full TypeScript support and type safety

## Installation

```bash
# Install globally
npm install -g @radkode/neo
# or with pnpm
pnpm add -g @radkode/neo
```

## Quick Start

```bash
# Display help and available commands
neo --help

# Initialize Neo CLI configuration
neo init

# Check for updates
neo update --check-only

# Configure a setting
neo config set editor.default "code"

# Smart git push with main branch protection
neo git push

# View current configuration
neo config list
```

## Demo

### Smart Git Push Protection

When attempting to push to the main branch, Neo intelligently prompts for confirmation:

```bash
$ neo git push

⚡ NEO CLI
  Radkode's Lightning-Fast CLI Framework

⚠️  You are about to push directly to the main branch.
This is generally not recommended as it bypasses code review processes.
✔ Are you sure you want to continue? » No

✅ Push cancelled. Here's how to push your changes safely:
  1. Create a feature branch: git checkout -b feature/your-feature-name
  2. Push to your branch: git push -u origin feature/your-feature-name
  3. Create a pull request to merge into main

This protects the main branch from accidental changes.
```

### Beautiful Configuration Management

```bash
$ neo config set theme.primary "#00ff88"
✨ Configuration saved: theme.primary = "#00ff88"

$ neo config list
📝 Your Configuration:

  🎨 theme.primary     "#00ff88"
  💻 editor.default   "code"
  🚀 workflow.auto    true
```

## Commands

### `init`

Install and configure Neo CLI globally.

```bash
neo init
```

Options:

- `--force` - Force reconfiguration if already initialized
- `--skip-install` - Skip global installation (configuration only)

### `config`

Manage configuration values with simple key-value storage.

```bash
# Set a configuration value
neo config set api.key "your-api-key"

# Get a configuration value
neo config get api.key

# List all configuration values
neo config list
```

Subcommands:

- `config get <key>` - Get a configuration value
- `config set <key> <value>` - Set a configuration value
- `config list` - List all configuration values

### `git`

Enhanced git operations with safety features.

#### `git push`

Smart git push with main branch protection.

```bash
# Regular push (prompts for confirmation on main branch)
neo git push

# Force push (use with caution)
neo git push --force

# Dry run to see what would be pushed
neo git push --dry-run

# Push and set upstream branch
neo git push --set-upstream origin feature-branch

# Push with tags
neo git push --tags
```

Options:

- `-f, --force` - Force push (overwrites remote)
- `-u, --set-upstream <branch>` - Set upstream branch
- `--dry-run` - Show what would be pushed without actually pushing
- `--tags` - Push tags along with commits

**Safety Features:**

- ⚠️ Interactive confirmation when pushing to main branch
- 📝 Helpful guidance for safer alternatives
- ✅ Graceful cancellation (exits with success code)
- 🎯 Encourages best practices while allowing flexibility

### `update`

Update Neo CLI to the latest version from npm.

```bash
# Update to the latest version (with confirmation)
neo update

# Check for updates without installing
neo update --check-only

# Force update/reinstall even if on latest version
neo update --force
```

Options:

- `--check-only` - Only check for updates without installing
- `--force` - Force update even if already on latest version

**Features:**

- 🔍 Automatic version checking against npm registry
- 📦 Smart package manager detection (npm, pnpm, yarn)
- ✨ Interactive confirmation before updating
- 🎯 Helpful error messages for permission issues
- ⚡ Progress indicators with real-time status

## Global Options

- `-v, --verbose` - Enable verbose logging
- `-c, --config <path>` - Path to config file
- `--no-color` - Disable colored output
- `--no-banner` - Hide banner
- `-h, --help` - Display help
- `-V, --version` - Display version

## Development

### Setup

```bash
git clone https://github.com/radkode/neo.git
cd neo
pnpm install
```

### Build

```bash
pnpm run build
```

### Test

```bash
pnpm test
pnpm run test:watch
pnpm run test:coverage
```

### Local Development

```bash
# Link for local testing
pnpm run link-local

# Test the CLI
neo --help

# Unlink when done
pnpm run unlink-local
```

### Versioning & Releases

This project uses [Changesets](https://github.com/changesets/changesets) for version management and publishing.

#### Creating a Changeset

When you make changes that should be released, create a changeset:

```bash
# Create a new changeset
pnpm changeset
```

This will:

1. Prompt you to select which packages to version (this project has one)
2. Ask for the type of change (patch, minor, major)
3. Request a description of the changes
4. Generate a changeset file in `.changeset/`

#### Release Workflow

```bash
# Check current changeset status
pnpm changeset:status

# Consume changesets and update version
pnpm version-packages

# Publish to npm (after tests pass)
pnpm release
```

#### Change Types

- **patch**: Bug fixes, small improvements (0.1.0 → 0.1.1)
- **minor**: New features, enhancements (0.1.0 → 0.2.0)
- **major**: Breaking changes (0.1.0 → 1.0.0)

#### CI Integration

The changeset workflow integrates with:

- GitHub releases and changelogs
- Automated version bumping
- NPM publishing pipeline

## License

MIT © Jacek Radko

---

Built with ⚡ by [Radkode](https://github.com/jacekradko)
