# Contributing to Neo CLI

Thanks for your interest in contributing to Neo CLI! This document outlines how to get started.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/radkode/neo.git
cd neo

# Install dependencies
pnpm install

# Build the project
pnpm run build

# Run tests
pnpm test
```

## Local Testing

```bash
# Link for local testing
pnpm run link-local

# Test your changes
neo --help

# Unlink when done
pnpm run unlink-local
```

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

- Follow the existing code style (enforced by ESLint and Prettier)
- Add tests for new functionality
- Update documentation if needed

### 3. Run Quality Checks

```bash
# Lint
pnpm run lint

# Format
pnpm run format

# Test
pnpm test

# Build
pnpm run build
```

### 4. Create a Changeset

We use [Changesets](https://github.com/changesets/changesets) for version management.

```bash
pnpm changeset
```

Select the change type:
- **patch**: Bug fixes, small improvements
- **minor**: New features, enhancements
- **major**: Breaking changes

### 5. Submit a Pull Request

- Provide a clear description of your changes
- Reference any related issues
- Ensure all checks pass

## Code Style

- TypeScript with strict mode
- ESLint + Prettier for formatting
- Prefer descriptive variable names
- Keep functions focused and small

## Commit Messages

Use clear, descriptive commit messages. We follow conventional commits loosely:

```
feat: add new stash command
fix: handle edge case in git push
docs: update README examples
```

## Testing

- Write tests for new features
- Ensure existing tests pass
- Aim for good coverage on critical paths

```bash
# Run tests
pnpm test

# Watch mode
pnpm run test:watch

# Coverage
pnpm run test:coverage
```

## Questions?

Open an issue for questions or discussions about potential changes.
