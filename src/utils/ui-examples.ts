#!/usr/bin/env tsx
/**
 * UI System Examples
 *
 * This file demonstrates all available UI methods with visual examples.
 * Run with: npx tsx src/utils/ui-examples.ts
 *
 * This is for development and testing only - not included in production builds.
 */

import { ui } from './ui.js';

async function runExamples(): Promise<void> {
  console.clear();

  // Show banner first
  console.log('\n');
  ui.section('Neo CLI UI System Examples');
  console.log('\n');

  // ============================================================================
  // Core Output Methods
  // ============================================================================

  ui.section('Core Output Methods');
  console.log('\n');

  ui.success('Successfully pushed to remote!');
  ui.error('Failed to connect to database');
  ui.warn('You are about to push directly to main branch');
  ui.info('Set upstream branch: feature/auth');
  ui.step('Proceeding with installation');
  ui.muted('This is secondary information that is less important');
  ui.highlight('Important: Back up your data before continuing');
  ui.link('Documentation', 'https://neo-cli.dev/docs');
  ui.link('https://github.com/neo-cli/neo');
  ui.log('Plain text without any styling');

  console.log('\n');

  // ============================================================================
  // Color Palette
  // ============================================================================

  ui.section('Color Palette');
  console.log('\n');

  ui.list([
    `Blue: ${ui.colors.blue} (info, links, highlights)`,
    `Purple: ${ui.colors.purple} (steps, progress)`,
    `Pink: ${ui.colors.pink} (accents, special notes)`,
    `Success: ${ui.colors.success} (success messages)`,
    `Error: ${ui.colors.error} (error messages)`,
    `Warning: ${ui.colors.warning} (warnings)`,
    `Muted: ${ui.colors.muted} (secondary text)`,
  ]);

  console.log('\n');

  // ============================================================================
  // Icon Reference
  // ============================================================================

  ui.section('Icon Reference');
  console.log('\n');

  ui.list([
    `${ui.icons.success} Success (U+2713 CHECK MARK)`,
    `${ui.icons.error} Error (U+2716 HEAVY MULTIPLICATION X)`,
    `${ui.icons.warning} Warning (U+26A0 WARNING SIGN)`,
    `${ui.icons.info} Info (U+2139 INFORMATION SOURCE)`,
    `${ui.icons.step} Step/Arrow (U+2192 RIGHTWARDS ARROW)`,
    `${ui.icons.bullet} List Item (U+2022 BULLET)`,
    `${ui.icons.highlight} Highlight (U+25C6 BLACK DIAMOND)`,
    `${ui.icons.collapsed} Collapsed (U+25B8 BLACK RIGHT-POINTING SMALL TRIANGLE)`,
    `${ui.icons.active} Active (U+25C9 FISHEYE)`,
  ]);

  console.log('\n');

  // ============================================================================
  // Structured Output: Lists
  // ============================================================================

  ui.section('Bulleted Lists');
  console.log('\n');

  ui.muted('What was configured:');
  ui.list([
    'Global installation: neo command available',
    'Configuration: ~/.config/neo/config.json',
    'Shell alias: n → neo',
    'Shell completions: enabled',
  ]);

  console.log('\n');

  // ============================================================================
  // Structured Output: Key-Value Pairs
  // ============================================================================

  ui.section('Key-Value Pairs');
  console.log('\n');

  ui.muted('User Configuration:');
  ui.keyValue([
    ['user.name', 'John Doe'],
    ['user.email', 'john@example.com'],
    ['preferences.theme', 'auto'],
    ['preferences.banner', 'full'],
  ]);

  console.log('\n');

  ui.muted('Installation Details:');
  ui.keyValue([
    ['version', '0.5.0'],
    ['installedAt', '2025-01-07T12:00:00Z'],
    ['globalPath', '/usr/local/lib/node_modules/@radkode/neo'],
  ]);

  console.log('\n');

  // ============================================================================
  // Structured Output: Tables
  // ============================================================================

  ui.section('Tables');
  console.log('\n');

  ui.muted('Outdated Packages:');
  console.log('');
  ui.table({
    headers: ['Package', 'Current', 'Latest'],
    rows: [
      ['typescript', '5.9.2', '5.9.3'],
      ['@types/node', '24.5.2', '24.7.0'],
      ['eslint', '9.36.0', '9.37.0'],
      ['jiti', '2.6.0', '2.6.1'],
    ],
  });

  console.log('\n');

  // ============================================================================
  // Structured Output: Code Blocks
  // ============================================================================

  ui.section('Code Blocks');
  console.log('\n');

  ui.muted('Example TypeScript code:');
  console.log('');
  ui.code(
    `import { ui } from '@/utils/ui.js';

ui.success('Operation completed!');
ui.warn('Be careful!');
ui.info('Here is some information');`,
    { language: 'typescript' }
  );

  console.log('\n');

  ui.muted('Code with line numbers:');
  console.log('');
  ui.code(
    `function hello(name: string): void {
  console.log(\`Hello, \${name}!\`);
}

hello('World');`,
    { language: 'typescript', lineNumbers: true, startLine: 1 }
  );

  console.log('\n');

  // ============================================================================
  // Dividers
  // ============================================================================

  ui.section('Dividers');
  console.log('\n');

  ui.muted('Use dividers to separate sections:');
  console.log('');
  ui.divider();

  console.log('\n');

  // ============================================================================
  // Spinner Example
  // ============================================================================

  ui.section('Spinner Examples');
  console.log('\n');

  ui.muted('Demonstrating spinner states:');
  console.log('');

  // Success spinner
  const spinner1 = ui.spinner('Installing packages');
  spinner1.start();
  await sleep(1500);
  spinner1.succeed('Packages installed successfully');

  // Failure spinner
  const spinner2 = ui.spinner('Connecting to database');
  spinner2.start();
  await sleep(1500);
  spinner2.fail('Failed to connect to database');

  // Warning spinner
  const spinner3 = ui.spinner('Checking for updates');
  spinner3.start();
  await sleep(1500);
  spinner3.warn('Updates available but not critical');

  // Info spinner
  const spinner4 = ui.spinner('Validating configuration');
  spinner4.start();
  await sleep(1500);
  spinner4.info('Configuration is valid');

  console.log('\n');

  // ============================================================================
  // Complex Example: Git Push Output
  // ============================================================================

  ui.section('Complex Example: Git Push Command');
  console.log('\n');

  ui.warn('You are about to push directly to main branch');
  ui.muted('This is generally not recommended as it bypasses code review');
  console.log('');

  ui.muted('(User confirms Yes)');
  console.log('');

  ui.step('Proceeding with push to main branch');
  const pushSpinner = ui.spinner('Pushing to remote');
  pushSpinner.start();
  await sleep(2000);
  pushSpinner.succeed('Successfully pushed to remote!');

  console.log('\n');

  // ============================================================================
  // Complex Example: Config List Output
  // ============================================================================

  ui.section('Complex Example: Config List Command');
  console.log('\n');

  ui.info('Current Neo CLI Configuration');
  console.log('');

  ui.log('User');
  ui.keyValue([
    ['user.name', 'John Doe'],
    ['user.email', 'john@example.com'],
  ]);
  console.log('');

  ui.log('Preferences');
  ui.keyValue([
    ['banner', 'full'],
    ['theme', 'auto'],
    ['aliases.n', 'enabled'],
  ]);
  console.log('');

  ui.log('Shell');
  ui.keyValue([
    ['type', 'zsh'],
    ['rcFile', '~/.zshrc'],
  ]);
  console.log('');

  ui.log('Installation');
  ui.keyValue([
    ['version', '0.5.0'],
    ['installedAt', '2025-01-07T12:00:00Z'],
  ]);
  console.log('');

  ui.divider();
  ui.muted('Config file: ~/.config/neo/config.json');

  console.log('\n');

  // ============================================================================
  // Fin!
  // ============================================================================

  ui.divider();
  console.log('');
  ui.success('All UI system examples completed!');
  ui.muted('These methods provide consistent, beautiful terminal output throughout Neo CLI');
  console.log('\n');
}

/**
 * Helper function to simulate async operations
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run examples
runExamples().catch((error) => {
  console.error('Failed to run examples:', error);
  process.exit(1);
});
