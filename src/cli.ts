import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import { displayBanner } from '@/utils/banner.js';
import type { BannerType } from '@/utils/banner.js';
import { logger } from '@/utils/logger.js';
import { registerCommands } from '@/commands/index.js';
import { configManager } from '@/utils/config.js';
import packageJson from '../package.json' assert { type: 'json' };

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
    .hook('preAction', async (thisCommand, actionCommand) => {
      const opts = thisCommand.opts();
      const commandName = actionCommand.name();

      // Determine banner display logic
      // Priority order:
      // 1. --no-banner flag (highest priority)
      // 2. Help/version commands (always skip)
      // 3. Config file preference

      const isHelpOrVersion =
        commandName === 'version' ||
        commandName === 'help' ||
        process.argv.includes('--version') ||
        process.argv.includes('-V') ||
        process.argv.includes('--help') ||
        process.argv.includes('-h');

      // Skip banner for help/version commands
      if (isHelpOrVersion) {
        return;
      }

      // Check for --no-banner flag
      if (opts.banner === false) {
        return;
      }

      // Read banner preference from config
      let bannerType: BannerType = 'full'; // Default fallback
      try {
        const config = await configManager.read();
        bannerType = config.preferences.banner;
      } catch (error) {
        // If config read fails, use default 'full' banner
        logger.debug(`Failed to read banner config, using default: ${error}`);
      }

      // Display banner based on configuration
      displayBanner(bannerType);

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
