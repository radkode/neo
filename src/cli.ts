import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import { showBanner } from '@/utils/banner.js';
import { logger } from '@/utils/logger.js';
import { registerCommands } from '@/commands/index.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

export function createCLI(): Command {
  const program = new Command();

  program
    .name('neo')
    .description(packageJson.description)
    .version(packageJson.version)
    .option('-v, --verbose', 'enable verbose logging')
    .option('-c, --config <path>', 'path to config file')
    .option('--no-color', 'disable colored output')
    .option('--no-banner', 'hide banner')
    .hook('preAction', (thisCommand, actionCommand) => {
      const opts = thisCommand.opts();
      const commandName = actionCommand.name();

      // Don't show banner for version, help, or when explicitly disabled
      const skipBanner =
        opts.banner === false ||
        commandName === 'version' ||
        commandName === 'help' ||
        process.argv.includes('--version') ||
        process.argv.includes('-V') ||
        process.argv.includes('--help') ||
        process.argv.includes('-h');

      if (!skipBanner) {
        showBanner();
      }

      // Configure logger
      if (opts.verbose) {
        logger.setVerbose(true);
        logger.debug(`Executing command: ${commandName}`);
      }

      // Disable colors if requested
      if (opts.color === false) {
        chalk.level = 0;
      }
    });

  // Register all commands
  registerCommands(program);

  return program;
}

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.js')) {
  const program = createCLI();

  // If no arguments provided (only the script name), show help
  if (process.argv.length <= 2) {
    program.help();
  }

  program.exitOverride();

  try {
    program.parse();
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err) {
      // Handle help display gracefully
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.help') {
        process.exit(0);
      }

      // Handle version display gracefully
      if (err.code === 'commander.version') {
        process.exit(0);
      }

      // Handle missing command gracefully
      if (err.code === 'commander.missingArgument' || err.code === 'commander.unknownCommand') {
        console.error(
          `\n${chalk.red('Error:')} ${err instanceof Error ? err.message : String(err)}`
        );
        console.log(`\nRun ${chalk.cyan('neo --help')} for usage information.`);
        process.exit(1);
      }
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(errorMessage);
    process.exit(1);
  }
}
