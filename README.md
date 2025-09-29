# @radkode/neo

⚡ Lightning-fast TypeScript CLI framework

## Installation

```bash
pnpm add -g @radkode/neo
```

Or install as a dev dependency:

```bash
pnpm add -D @radkode/neo
```

## Usage

```bash
# Initialize a new project
neo init my-project

# Build the project
neo build --watch

# Deploy to production
neo deploy production

# Manage configuration
neo config set api.key YOUR_KEY
neo config get api.key
neo config list
```

## Commands

### `init [name]`
Initialize a new project with optional name.

Options:
- `-t, --template <type>` - Project template (default: "default")
- `--skip-install` - Skip dependency installation
- `--force` - Overwrite existing files

### `build`
Build the project.

Options:
- `-w, --watch` - Watch for changes
- `-m, --minify` - Minify output
- `--source-maps` - Generate source maps
- `-o, --output <dir>` - Output directory (default: "dist")

### `deploy [environment]`
Deploy the project to specified environment.

Options:
- `--dry-run` - Perform a dry run without deploying
- `--skip-build` - Skip the build step
- `--force` - Force deployment without confirmation

### `config`
Manage configuration values.

Subcommands:
- `config get <key>` - Get a configuration value
- `config set <key> <value>` - Set a configuration value
- `config list` - List all configuration values

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
git clone https://github.com/jacekradko/radkode/neo.git
cd radkode/neo
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
