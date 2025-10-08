# Neo CLI - Warp Development Guidelines

This file contains project-specific guidelines and best practices for developing Neo CLI. These rules ensure consistency, maintainability, and a high-quality codebase.

## Table of Contents

- [UI System](#ui-system)
- [TypeScript Guidelines](#typescript-guidelines)
- [Code Organization](#code-organization)
- [Testing](#testing)
- [Git Workflow](#git-workflow)
- [Package Management](#package-management)
- [Error Handling](#error-handling)

---

## UI System

### **CRITICAL: Always Use the UI System for Console Output**

Neo CLI has a unified UI system for all terminal output. **NEVER** use raw `console.log`, `console.error`, `chalk`, or `ora` directly.

### Import the UI System

```typescript
import { ui } from '@/utils/ui.js';
```

### Core Output Methods

**Status Messages:**
```typescript
ui.success('Operation completed successfully');  // ✓ with green
ui.error('Operation failed');                   // ✖ with red
ui.warn('Be careful with this action');         // ⚠ with amber
ui.info('Here is some information');            // ℹ with blue
```

**Context Messages:**
```typescript
ui.step('Proceeding with installation');        // → with purple
ui.muted('Secondary information');              // Gray, no icon
ui.highlight('Important: Read this carefully'); // ◆ with pink
ui.link('Documentation', 'https://url.com');    // Underlined blue
ui.log('Plain text without styling');           // No styling
```

### Structured Output

**Sections with Headers:**
```typescript
ui.section('Configuration');
// Output:
// Configuration
// ─────────────
```

**Lists:**
```typescript
ui.list([
  'Global installation: neo command available',
  'Configuration: ~/.config/neo/config.json',
  'Shell alias: n → neo',
]);
// Output:
//   • Global installation: neo command available
//   • Configuration: ~/.config/neo/config.json
//   • Shell alias: n → neo
```

**Key-Value Pairs:**
```typescript
ui.keyValue([
  ['user.name', 'John Doe'],
  ['user.email', 'john@example.com'],
  ['version', '0.5.0'],
]);
// Output:
//   user.name :  John Doe
//   user.email:  john@example.com
//   version   :  0.5.0
```

**Tables:**
```typescript
ui.table({
  headers: ['Package', 'Current', 'Latest'],
  rows: [
    ['typescript', '5.9.2', '5.9.3'],
    ['eslint', '9.36.0', '9.37.0'],
  ],
});
// Output:
// ┌────────────┬─────────┬────────┐
// │ Package    │ Current │ Latest │
// ├────────────┼─────────┼────────┤
// │ typescript │ 5.9.2   │ 5.9.3  │
// │ eslint     │ 9.36.0  │ 9.37.0 │
// └────────────┴─────────┴────────┘
```

**Code Blocks:**
```typescript
ui.code('const x = 42;\nconst y = 24;', { 
  lineNumbers: true,
  startLine: 1 
});
```

**Dividers:**
```typescript
ui.divider();
// Output: ────────────────────────────────────────
```

### Spinners

**Always use ui.spinner() instead of ora():**

```typescript
// ✅ Correct
const spinner = ui.spinner('Loading data');
spinner.start();
// ... do work ...
spinner.succeed('Data loaded successfully');

// ❌ Wrong - Never use ora directly
const spinner = ora('Loading data').start();
```

**Spinner methods:**
```typescript
spinner.succeed('Success message');  // ✓ green
spinner.fail('Error message');       // ✖ red
spinner.warn('Warning message');     // ⚠ amber
spinner.info('Info message');        // ℹ blue
```

### Color Palette Reference

The UI system uses a consistent color palette:
- **Blue** `#0066FF` - Info, links, highlights
- **Purple** `#997FFF` - Steps, progress
- **Pink** `#F33FFF` - Highlights, accents
- **Success** `#00CC66` - Success messages
- **Error** `#FF3366` - Errors
- **Warning** `#FFAA33` - Warnings
- **Muted** `#6B7280` - Secondary text

### Icons Reference

All icons are consistent unicode symbols:
- `✓` Success (U+2713)
- `✖` Error (U+2716)
- `⚠` Warning (U+26A0)
- `ℹ` Info (U+2139)
- `→` Step/Arrow (U+2192)
- `•` List Item (U+2022)
- `◆` Highlight (U+25C6)

### Migration Examples

**Before (Inconsistent):**
```typescript
import chalk from 'chalk';
import ora from 'ora';

logger.log(chalk.yellow.bold('⚠️  Warning message'));
logger.log(chalk.gray('Secondary text'));
const spinner = ora('Loading...').start();
spinner.succeed(chalk.green('Done!'));
```

**After (Consistent):**
```typescript
import { ui } from '@/utils/ui.js';

ui.warn('Warning message');
ui.muted('Secondary text');
const spinner = ui.spinner('Loading');
spinner.succeed('Done!');
```

---

## TypeScript Guidelines

### Strict Type Safety

- **Always** define explicit return types for functions
- **Never** use `any` type - prefer `unknown` when type is uncertain
- Use proper type guards and type narrowing
- Enable all strict mode checks in `tsconfig.json`

**Example:**
```typescript
// ✅ Correct
function processData(input: string): ProcessedData {
  // implementation
}

// ❌ Wrong
function processData(input: any) {
  // implementation
}
```

### Type Definitions

- Define interfaces for all data structures
- Use `type` for unions and intersections
- Use `interface` for object shapes that may be extended
- Document all types with JSDoc comments

**Example:**
```typescript
/**
 * Configuration options for the update command
 */
interface UpdateOptions {
  /** Only check for updates without installing */
  checkOnly?: boolean;
  /** Force update even if already on latest version */
  force?: boolean;
}
```

### Null Checking

- Use optional chaining (`?.`) for safe property access
- Use nullish coalescing (`??`) for default values
- Prefer explicit null checks over truthy/falsy checks

**Example:**
```typescript
// ✅ Correct
const name = user?.profile?.name ?? 'Unknown';

// ❌ Wrong
const name = user && user.profile && user.profile.name || 'Unknown';
```

---

## Code Organization

### File Structure

```
src/
├── commands/          # Command implementations
│   ├── git/
│   │   ├── push/
│   │   │   └── index.ts
│   │   └── pull/
│   │       └── index.ts
│   └── config/
│       └── index.ts
├── utils/             # Utility functions
│   ├── ui.ts         # UI system (use this!)
│   ├── ui-types.ts   # UI type definitions
│   ├── logger.ts     # Legacy logger (use ui instead)
│   └── config.ts     # Configuration management
└── types/             # Type definitions
    └── index.ts
```

### Import Organization

Order imports as follows:
1. Node.js built-ins
2. External dependencies
3. Internal utilities (using `@/` path alias)
4. Types

**Example:**
```typescript
import { readFile } from 'fs/promises';
import { Command } from '@commander-js/extra-typings';
import inquirer from 'inquirer';
import { ui } from '@/utils/ui.js';
import { configManager } from '@/utils/config.js';
import type { InitOptions } from '@/types/index.js';
```

### Module Exports

- Use named exports, avoid default exports for utilities
- Export types alongside implementations
- Document all public APIs with JSDoc

**Example:**
```typescript
/**
 * Create the git push command
 */
export function createPushCommand(): Command {
  // implementation
}

export type { GitPushOptions } from './types.js';
```

---

## Testing

### Test Framework

- Use **Vitest** for all tests
- Place tests in `test/` directory mirroring `src/` structure
- Name test files with `.test.ts` extension

### Test Coverage

- Aim for high test coverage (80%+ minimum)
- Test all public APIs
- Test error conditions and edge cases
- Mock external dependencies (filesystem, network, etc.)

### UI System Testing

When testing code that uses the UI system:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ui } from '../../src/utils/ui.js';

describe('My Command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should display success message', () => {
    ui.success('Test message');
    expect(consoleLogSpy).toHaveBeenCalled();
  });
});
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test path/to/test.test.ts

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

---

## Git Workflow

### Commit Messages

Follow conventional commit format:

```
type(scope): subject

body (optional)

footer (optional)
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Test additions or changes
- `chore`: Build process or auxiliary tool changes

**Examples:**
```
feat(ui): add table rendering support
fix(git): handle authentication errors properly
docs(readme): update installation instructions
```

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `refactor/description` - Code refactoring
- `docs/description` - Documentation updates

### Pull Request Guidelines

- Keep PRs focused and small
- Update tests for code changes
- Ensure all tests pass before requesting review
- Update documentation if API changes

---

## Package Management

### Always Use pnpm

Neo CLI uses **pnpm** as the package manager. Never use npm or yarn.

```bash
# Install dependencies
pnpm install

# Add a dependency
pnpm add package-name

# Add a dev dependency
pnpm add -D package-name

# Update dependencies
pnpm update

# Check for outdated packages
pnpm outdated
```

### Scripts

Common scripts defined in `package.json`:

```bash
pnpm dev              # Run CLI in development mode
pnpm build            # Build for production
pnpm test             # Run tests
pnpm tsc              # Type check
pnpm lint             # Lint code
pnpm format           # Format code
```

---

## Error Handling

### User-Facing Errors

Always use the UI system for error messages:

```typescript
try {
  // operation
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('not found')) {
      ui.error('File not found');
      ui.warn('Make sure the path is correct');
      process.exit(1);
    }
  }
  
  ui.error('An unexpected error occurred');
  ui.muted(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

### Error Messages Best Practices

1. **Be specific** - Tell users exactly what went wrong
2. **Be helpful** - Suggest how to fix the issue
3. **Be consistent** - Use the same format everywhere

**Example:**
```typescript
// ✅ Good
ui.error('Git repository not found');
ui.warn('Make sure you are in a git repository directory');
ui.muted('Run: git init');

// ❌ Bad
console.error('Error: not a git repo');
```

### Exit Codes

- `0` - Success
- `1` - General error
- Exit gracefully with appropriate messages

---

## Development Commands

### Quick Reference

```bash
# Start development
pnpm dev

# Run CLI with arguments
pnpm dev config list
pnpm dev git push

# Type checking
pnpm tsc --noEmit

# Run tests
pnpm test

# View UI examples
npx tsx src/utils/ui-examples.ts

# Build for production
pnpm build

# Check for outdated packages
pnpm outdated
```

---

## Additional Resources

- **UI System Design**: See `docs/UI_DESIGN.md` for complete UI system documentation
- **Architecture**: See `docs/ARCHITECTURE_ANALYSIS_SEP_2025.md` for system architecture
- **Examples**: Run `npx tsx src/utils/ui-examples.ts` to see all UI methods in action

---

## Summary: Most Important Rules

1. ✅ **ALWAYS use `ui` for console output** - Never use `console.log`, `chalk`, or `ora` directly
2. ✅ **Use pnpm** - Never use npm or yarn
3. ✅ **Write tests** - Test all new features and bug fixes
4. ✅ **Type everything** - Use explicit TypeScript types
5. ✅ **Handle errors gracefully** - Use ui.error() with helpful messages
6. ✅ **Follow the file structure** - Keep code organized
7. ✅ **Document your code** - Use JSDoc for all public APIs

---

**Last Updated:** 2025-01-08
**Version:** 1.0.0
