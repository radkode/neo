#!/bin/bash

# ============================================
# RADKODE CLI BOOTSTRAP SCRIPT
# ============================================
# This script will create a complete TypeScript CLI project
# Change these variables to customize your CLI

CLI_NAME="neo"                    # Your chosen CLI name
NPM_ORG="@radkode"               # Your npm organization
FULL_PACKAGE_NAME="@radkode/neo" # Full package name
DESCRIPTION="⚡ Lightning-fast TypeScript CLI framework"
AUTHOR="Jacek Radko"
GITHUB_USER="jacekradko"
GITHUB_REPO="radkode/neo"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}⚡ Creating ${YELLOW}$FULL_PACKAGE_NAME${BLUE} CLI Project${NC}"
echo "================================================"

# ============================================
# STEP 1: Create Project Directory
# ============================================
echo -e "\n${GREEN}📁 Creating project structure...${NC}"

# Create directory structure
mkdir -p src/{commands,utils,types}
mkdir -p src/commands/{init,build,deploy,config}
mkdir -p test
mkdir -p bin
mkdir -p .github/workflows

# ============================================
# STEP 2: Initialize Git
# ============================================
echo -e "\n${GREEN}🔧 Initializing Git repository...${NC}"

# Create .gitignore
cat > .gitignore << 'EOL'
# Dependencies
node_modules/

# Build output
dist/
*.tsbuildinfo

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/*
!.vscode/extensions.json
!.vscode/launch.json
!.vscode/settings.json
.idea/
*.swp
*.swo

# Environment
.env
.env.local
.env.*.local

# Test coverage
coverage/
.nyc_output/

# Config
config.json
EOL

# Create .npmignore
cat > .npmignore << 'EOL'
# Source files
src/
test/
*.ts
!*.d.ts

# Config files
tsconfig.json
jest.config.js
.eslintrc.js
.prettierrc

# Git
.git/
.gitignore
.github/

# Development
.vscode/
.idea/
*.log
coverage/
.nyc_output/

# Docs
docs/
*.md
!README.md
EOL

# ============================================
# STEP 3: Create package.json
# ============================================
echo -e "\n${GREEN}📦 Creating package.json...${NC}"

cat > package.json << EOL
{
  "name": "$FULL_PACKAGE_NAME",
  "version": "0.1.0",
  "description": "$DESCRIPTION",
  "author": "$AUTHOR",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "$CLI_NAME": "./bin/cli.js"
  },
  "files": [
    "dist",
    "bin"
  ],
  "keywords": [
    "cli",
    "typescript",
    "commander",
    "radkode",
    "terminal",
    "command-line"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/$GITHUB_USER/$GITHUB_REPO.git"
  },
  "bugs": {
    "url": "https://github.com/$GITHUB_USER/$GITHUB_REPO/issues"
  },
  "homepage": "https://github.com/$GITHUB_USER/$GITHUB_REPO#readme",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "start": "node dist/cli.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts",
    "format": "prettier --write \"src/**/*.ts\"",
    "prepublishOnly": "pnpm run build && pnpm run test",
    "link-local": "pnpm run build && pnpm link --global",
    "unlink-local": "pnpm unlink --global $FULL_PACKAGE_NAME"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=8.0.0"
  },
  "packageManager": "pnpm@8.15.0"
}
EOL

# ============================================
# STEP 4: Create TypeScript Configuration
# ============================================
echo -e "\n${GREEN}🔷 Creating TypeScript configuration...${NC}"

cat > tsconfig.json << 'EOL'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": false,
    "removeComments": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": [
    "node_modules",
    "dist",
    "**/*.spec.ts",
    "**/*.test.ts"
  ]
}
EOL

# ============================================
# STEP 5: Create Vitest Configuration
# ============================================
echo -e "\n${GREEN}🧪 Creating Vitest configuration...${NC}"

cat > vitest.config.ts << 'EOL'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**'
      ]
    }
  }
});
EOL

# ============================================
# STEP 6: Create ESLint Configuration
# ============================================
echo -e "\n${GREEN}🔍 Creating ESLint configuration...${NC}"

cat > .eslintrc.js << 'EOL'
module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  plugins: ['@typescript-eslint'],
  env: {
    node: true,
    jest: true,
    es2022: true
  },
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'off'
  }
};
EOL

# ============================================
# STEP 7: Create Prettier Configuration
# ============================================
echo -e "\n${GREEN}💅 Creating Prettier configuration...${NC}"

cat > .prettierrc << 'EOL'
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "lf"
}
EOL

# ============================================
# STEP 8: Create Executable Entry Point
# ============================================
echo -e "\n${GREEN}🚀 Creating executable entry point...${NC}"

cat > bin/cli.js << 'EOL'
#!/usr/bin/env node
import('../dist/cli.js');
EOL

chmod +x bin/cli.js

# ============================================
# STEP 9: Create Main Source Files
# ============================================
echo -e "\n${GREEN}📝 Creating source files...${NC}"

# Create ASCII banner utility
cat > src/utils/banner.ts << EOL
import chalk from 'chalk';

export function showBanner(): void {
  const banner = \`
${YELLOW}⚡ ZAP CLI${NC}
  ${BLUE}\${chalk.dim('Radkode\'s Lightning-Fast CLI Framework')}${NC}
  \`;
  console.log(banner);
}
EOL

# Create index.ts
cat > src/index.ts << 'EOL'
// Main export file for programmatic usage
export * from './commands';
export * from './utils/logger';
export * from './types';
export { createCLI } from './cli';
EOL

# Create cli.ts
cat > src/cli.ts << EOL
import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import { showBanner } from './utils/banner.js';
import { logger } from './utils/logger.js';
import { registerCommands } from './commands/index.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

export function createCLI(): Command {
  const program = new Command();

  program
    .name('$CLI_NAME')
    .description(packageJson.description)
    .version(packageJson.version)
    .option('-v, --verbose', 'enable verbose logging')
    .option('-c, --config <path>', 'path to config file')
    .option('--no-color', 'disable colored output')
    .option('--no-banner', 'hide banner')
    .hook('preAction', (thisCommand, actionCommand) => {
      const opts = thisCommand.opts();
      
      // Show banner unless disabled
      if (opts.banner !== false && !opts.version && !opts.help) {
        showBanner();
      }
      
      // Configure logger
      if (opts.verbose) {
        logger.setVerbose(true);
        logger.debug(\`Executing command: \${actionCommand.name()}\`);
      }
      
      // Disable colors if requested
      if (opts.noColor) {
        chalk.level = 0;
      }
    });

  // Register all commands
  registerCommands(program);

  return program;
}

// Only run if this is the main module
if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const program = createCLI();
  
  program.exitOverride();
  
  try {
    program.parse();
  } catch (err: any) {
    if (err.code === 'commander.helpDisplayed') {
      process.exit(0);
    }
    logger.error(err.message);
    process.exit(1);
  }
}
EOL

# Create logger utility
cat > src/utils/logger.ts << 'EOL'
import chalk from 'chalk';

class Logger {
  private verbose: boolean = false;

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  }

  success(message: string): void {
    console.log(chalk.green('✓'), message);
  }

  warn(message: string): void {
    console.log(chalk.yellow('⚠'), message);
  }

  error(message: string): void {
    console.error(chalk.red('✖'), message);
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(chalk.gray('[DEBUG]'), message);
    }
  }

  log(message: string): void {
    console.log(message);
  }
}

export const logger = new Logger();
EOL

# Create types
cat > src/types/index.ts << 'EOL'
export interface BaseOptions {
  verbose?: boolean;
  config?: string;
  color?: boolean;
  banner?: boolean;
}

export interface InitOptions extends BaseOptions {
  template: string;
  skipInstall?: boolean;
  force?: boolean;
}

export interface BuildOptions extends BaseOptions {
  watch?: boolean;
  minify?: boolean;
  sourceMaps?: boolean;
  output: string;
}

export interface DeployOptions extends BaseOptions {
  environment?: string;
  dryRun?: boolean;
  skipBuild?: boolean;
  force?: boolean;
}
EOL

# Create command registry
cat > src/commands/index.ts << 'EOL'
import { Command } from '@commander-js/extra-typings';
import { createInitCommand } from './init/index.js';
import { createBuildCommand } from './build/index.js';
import { createDeployCommand } from './deploy/index.js';
import { createConfigCommand } from './config/index.js';

export function registerCommands(program: Command): void {
  program.addCommand(createInitCommand());
  program.addCommand(createBuildCommand());
  program.addCommand(createDeployCommand());
  program.addCommand(createConfigCommand());
}

export { createInitCommand } from './init/index.js';
export { createBuildCommand } from './build/index.js';
export { createDeployCommand } from './deploy/index.js';
export { createConfigCommand } from './config/index.js';
EOL

# Create init command
cat > src/commands/init/index.ts << 'EOL'
import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import { logger } from '../../utils/logger.js';
import { InitOptions } from '../../types/index.js';

export function createInitCommand(): Command {
  const command = new Command('init');

  command
    .description('Initialize a new project')
    .argument('[name]', 'project name', 'my-project')
    .option('-t, --template <type>', 'project template', 'default')
    .option('--skip-install', 'skip dependency installation')
    .option('--force', 'overwrite existing files')
    .action(async (name: string, options: InitOptions) => {
      const spinner = ora('Initializing project...').start();

      try {
        logger.debug(`Creating project: ${name}`);
        logger.debug(`Template: ${options.template}`);
        
        // Simulate project creation
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        spinner.succeed(chalk.green('Project initialized successfully!'));
        
        logger.info(`\nProject created: ${chalk.cyan(name)}`);
        logger.info('\nNext steps:');
        logger.log(`  ${chalk.gray('$')} cd ${name}`);
        if (!options.skipInstall) {
          logger.log(`  ${chalk.gray('$')} pnpm install`);
        }
        logger.log(`  ${chalk.gray('$')} pnpm run dev`);

      } catch (error: any) {
        spinner.fail('Failed to initialize project');
        throw error;
      }
    });

  return command;
}
EOL

# Create build command
cat > src/commands/build/index.ts << 'EOL'
import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import { logger } from '../../utils/logger.js';
import { BuildOptions } from '../../types/index.js';

export function createBuildCommand(): Command {
  const command = new Command('build');

  command
    .description('Build the project')
    .option('-w, --watch', 'watch for changes')
    .option('-m, --minify', 'minify output')
    .option('--source-maps', 'generate source maps')
    .option('-o, --output <dir>', 'output directory', 'dist')
    .action(async (options: BuildOptions) => {
      const spinner = ora('Building project...').start();

      try {
        logger.debug(`Output directory: ${options.output}`);
        logger.debug(`Minify: ${options.minify || false}`);
        logger.debug(`Source maps: ${options.sourceMaps || false}`);
        
        // Simulate build
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        spinner.succeed(chalk.green('Build completed successfully!'));
        
        if (options.watch) {
          logger.info(chalk.yellow('\n👁  Watching for changes...'));
        }

      } catch (error: any) {
        spinner.fail('Build failed');
        throw error;
      }
    });

  return command;
}
EOL

# Create deploy command
cat > src/commands/deploy/index.ts << 'EOL'
import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import { logger } from '../../utils/logger.js';
import { DeployOptions } from '../../types/index.js';

export function createDeployCommand(): Command {
  const command = new Command('deploy');

  command
    .description('Deploy the project')
    .argument('[environment]', 'deployment environment', 'development')
    .option('--dry-run', 'perform a dry run without deploying')
    .option('--skip-build', 'skip the build step')
    .option('--force', 'force deployment without confirmation')
    .action(async (environment: string, options: DeployOptions) => {
      const spinner = ora(`Deploying to ${environment}...`).start();

      try {
        logger.debug(`Environment: ${environment}`);
        logger.debug(`Dry run: ${options.dryRun || false}`);
        
        if (!options.skipBuild) {
          spinner.text = 'Building project...';
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        spinner.text = `Deploying to ${environment}...`;
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        if (options.dryRun) {
          spinner.info(chalk.yellow('Dry run completed (no actual deployment)'));
        } else {
          spinner.succeed(chalk.green(`Successfully deployed to ${environment}!`));
        }

      } catch (error: any) {
        spinner.fail(`Deployment to ${environment} failed`);
        throw error;
      }
    });

  return command;
}
EOL

# Create config command
cat > src/commands/config/index.ts << 'EOL'
import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import { logger } from '../../utils/logger.js';

export function createConfigCommand(): Command {
  const command = new Command('config');

  command
    .description('Manage configuration')
    .addCommand(createConfigGetCommand())
    .addCommand(createConfigSetCommand())
    .addCommand(createConfigListCommand());

  return command;
}

function createConfigGetCommand(): Command {
  const command = new Command('get');
  
  command
    .description('Get a configuration value')
    .argument('<key>', 'configuration key')
    .action((key: string) => {
      // Placeholder implementation
      logger.info(`Getting config: ${chalk.cyan(key)}`);
    });

  return command;
}

function createConfigSetCommand(): Command {
  const command = new Command('set');
  
  command
    .description('Set a configuration value')
    .argument('<key>', 'configuration key')
    .argument('<value>', 'configuration value')
    .action((key: string, value: string) => {
      // Placeholder implementation
      logger.success(`Config set: ${chalk.cyan(key)} = ${chalk.green(value)}`);
    });

  return command;
}

function createConfigListCommand(): Command {
  const command = new Command('list');
  
  command
    .description('List all configuration values')
    .action(() => {
      // Placeholder implementation
      logger.info('Configuration values:');
      logger.log(`  ${chalk.cyan('api.key')}: ${chalk.green('****')}`);
      logger.log(`  ${chalk.cyan('theme')}: ${chalk.green('dark')}`);
    });

  return command;
}
EOL

# Create a test file
cat > test/cli.test.ts << 'EOL'
import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';
import { createCLI } from '../src/cli.js';

describe('CLI', () => {
  let program: Command;

  beforeEach(() => {
    program = createCLI();
  });

  it('should have the correct name', () => {
    expect(program.name()).toBe('$CLI_NAME');
  });

  it('should have a version', () => {
    expect(program.version()).toBeDefined();
  });

  it('should have verbose option', () => {
    const options = program.options;
    const verboseOption = options.find(opt => opt.long === '--verbose');
    expect(verboseOption).toBeDefined();
  });

  it('should have init command', () => {
    const commands = program.commands;
    const initCommand = commands.find(cmd => cmd.name() === 'init');
    expect(initCommand).toBeDefined();
  });

  it('should have build command', () => {
    const commands = program.commands;
    const buildCommand = commands.find(cmd => cmd.name() === 'build');
    expect(buildCommand).toBeDefined();
  });

  it('should have deploy command', () => {
    const commands = program.commands;
    const deployCommand = commands.find(cmd => cmd.name() === 'deploy');
    expect(deployCommand).toBeDefined();
  });

  it('should have config command', () => {
    const commands = program.commands;
    const configCommand = commands.find(cmd => cmd.name() === 'config');
    expect(configCommand).toBeDefined();
  });
});
EOL

# ============================================
# STEP 10: Create README
# ============================================
echo -e "\n${GREEN}📚 Creating README...${NC}"

cat > README.md << EOL
# $FULL_PACKAGE_NAME

$DESCRIPTION

## Installation

\`\`\`bash
pnpm add -g $FULL_PACKAGE_NAME
\`\`\`

Or install as a dev dependency:

\`\`\`bash
pnpm add -D $FULL_PACKAGE_NAME
\`\`\`

## Usage

\`\`\`bash
# Initialize a new project
$CLI_NAME init my-project

# Build the project
$CLI_NAME build --watch

# Deploy to production
$CLI_NAME deploy production

# Manage configuration
$CLI_NAME config set api.key YOUR_KEY
$CLI_NAME config get api.key
$CLI_NAME config list
\`\`\`

## Commands

### \`init [name]\`
Initialize a new project with optional name.

Options:
- \`-t, --template <type>\` - Project template (default: "default")
- \`--skip-install\` - Skip dependency installation
- \`--force\` - Overwrite existing files

### \`build\`
Build the project.

Options:
- \`-w, --watch\` - Watch for changes
- \`-m, --minify\` - Minify output
- \`--source-maps\` - Generate source maps
- \`-o, --output <dir>\` - Output directory (default: "dist")

### \`deploy [environment]\`
Deploy the project to specified environment.

Options:
- \`--dry-run\` - Perform a dry run without deploying
- \`--skip-build\` - Skip the build step
- \`--force\` - Force deployment without confirmation

### \`config\`
Manage configuration values.

Subcommands:
- \`config get <key>\` - Get a configuration value
- \`config set <key> <value>\` - Set a configuration value
- \`config list\` - List all configuration values

## Global Options

- \`-v, --verbose\` - Enable verbose logging
- \`-c, --config <path>\` - Path to config file
- \`--no-color\` - Disable colored output
- \`--no-banner\` - Hide banner
- \`-h, --help\` - Display help
- \`-V, --version\` - Display version

## Development

### Setup

\`\`\`bash
git clone https://github.com/$GITHUB_USER/$GITHUB_REPO.git
cd $GITHUB_REPO
pnpm install
\`\`\`

### Build

\`\`\`bash
pnpm run build
\`\`\`

### Test

\`\`\`bash
pnpm test
pnpm run test:watch
pnpm run test:coverage
\`\`\`

### Local Development

\`\`\`bash
# Link for local testing
pnpm run link-local

# Test the CLI
$CLI_NAME --help

# Unlink when done
pnpm run unlink-local
\`\`\`

## License

MIT © $AUTHOR

---

Built with ⚡ by [Radkode](https://github.com/$GITHUB_USER)
EOL

# ============================================
# STEP 11: Create GitHub Actions Workflow
# ============================================
echo -e "\n${GREEN}🔄 Creating GitHub Actions workflow...${NC}"

cat > .github/workflows/ci.yml << 'EOL'
name: CI

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [20.x, 22.x]
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Use Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v4
      with:
        node-version: ${{ matrix.node-version }}
    
    - name: Install pnpm
      uses: pnpm/action-setup@v4
      with:
        version: 8
    
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
    
    - name: Run linter
      run: pnpm run lint
    
    - name: Run tests
      run: pnpm test
    
    - name: Build
      run: pnpm run build
EOL

cat > .github/workflows/publish.yml << 'EOL'
name: Publish to npm

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'
      
      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 8
      
      - run: pnpm install --frozen-lockfile
      
      - run: pnpm test
      
      - run: pnpm run build
      
      - run: pnpm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{secrets.NPM_TOKEN}}
EOL

# ============================================
# STEP 12: Create VS Code Configuration
# ============================================
echo -e "\n${GREEN}💻 Creating VS Code configuration...${NC}"

mkdir -p .vscode

cat > .vscode/launch.json << 'EOL'
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CLI",
      "program": "${workspaceFolder}/src/cli.ts",
      "args": ["init", "test-project", "--verbose"],
      "runtimeArgs": ["--loader", "tsx/esm"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Current Test",
      "program": "${workspaceFolder}/node_modules/.bin/vitest",
      "args": [
        "run",
        "${relativeFile}"
      ],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
EOL

cat > .vscode/settings.json << 'EOL'
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
EOL

cat > .vscode/extensions.json << 'EOL'
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-typescript-tslint-plugin"
  ]
}
EOL

# ============================================
# STEP 13: Install Dependencies
# ============================================
echo -e "\n${GREEN}📦 Installing dependencies...${NC}"

# Core dependencies
pnpm add commander @commander-js/extra-typings chalk@5 ora@6 inquirer@9

# Dev dependencies
pnpm add -D \
  typescript \
  @types/node \
  @types/inquirer \
  tsx \
  vitest \
  @vitest/coverage-v8 \
  eslint \
  @typescript-eslint/parser \
  @typescript-eslint/eslint-plugin \
  prettier \
  eslint-config-prettier

# ============================================
# STEP 14: Build the Project
# ============================================
echo -e "\n${GREEN}🔨 Building the project...${NC}"

pnpm run build

# ============================================
# STEP 15: Run Tests
# ============================================
echo -e "\n${GREEN}🧪 Running tests...${NC}"

pnpm test

# ============================================
# STEP 16: Create Initial Commit
# ============================================
echo -e "\n${GREEN}📝 Creating initial commit...${NC}"

git add .
git commit -m "🚀 Initial commit - $FULL_PACKAGE_NAME CLI"

# ============================================
# FINAL OUTPUT
# ============================================
echo -e "\n${GREEN}${YELLOW}⚡ SUCCESS!${GREEN} Your CLI project is ready!${NC}"
echo "================================================"
echo -e "${BLUE}Project created at:${NC} $(pwd)"
echo -e "\n${YELLOW}Next steps:${NC}"
echo -e "  1. ${BLUE}Test locally:${NC}"
echo -e "     ${GRAY}pnpm run link-local${NC}"
echo -e "     ${GRAY}$CLI_NAME --help${NC}"
echo -e ""
echo -e "  2. ${BLUE}Customize your commands:${NC}"
echo -e "     ${GRAY}Edit files in src/commands/${NC}"
echo -e ""
echo -e "  3. ${BLUE}Set up GitHub:${NC}"
echo -e "     ${GRAY}git remote add origin https://github.com/$GITHUB_USER/$GITHUB_REPO.git${NC}"
echo -e "     ${GRAY}git push -u origin main${NC}"
echo -e ""
echo -e "  4. ${BLUE}Publish to npm:${NC}"
echo -e "     ${GRAY}pnpm login${NC}"
echo -e "     ${GRAY}pnpm publish --access public${NC}"
echo -e ""
echo -e "${GREEN}Happy coding! ⚡${NC}"