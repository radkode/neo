import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import { displayBanner } from '@/utils/banner.js';
import type { BannerType } from '@/utils/banner.js';
import { logger } from '@/utils/logger.js';
import { registerCommands } from '@/commands/index.js';
import { configManager } from '@/utils/config.js';
import { notifyIfCliUpdateAvailable } from '@/utils/update-check.js';
import { Colors } from '@/utils/ui-types.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import packageJson from '../package.json' with { type: 'json' };

export async function createCLI(): Promise<Command> {
  const program = new Command();

  program
    .name('neo')
    .description(packageJson.description)
    .version(packageJson.version)
    .option('-v, --verbose', 'enable verbose logging')
    .option('-c, --config <path>', 'path to config file')
    .option('--no-color', 'disable colored output')
    .option('--no-banner', 'hide banner')
    .option('--json', 'emit machine-readable JSON on stdout (implies --non-interactive, --quiet)')
    .option('-y, --yes', 'auto-accept prompt defaults (agent-friendly)')
    .option('--non-interactive', 'fail fast instead of prompting for missing input')
    .option('-q, --quiet', 'suppress banner, spinners, and decorative output')
    .addHelpText(
      'after',
      `
Agent mode:
  Flags   --json, --yes, --non-interactive, --quiet, --no-color, --no-banner
  Env     NEO_JSON, NEO_YES, NEO_NON_INTERACTIVE, NEO_QUIET, NO_COLOR, CI
  Schema  neo schema                         dump every command & option as JSON
  Quick   neo git commit --ai --yes --json   AI commit, no prompts, JSON output
          neo git pull --yes --json          pull + auto-rebase, structured result
          neo gh pr create --yes --json      push + PR using inferred title

Exit codes:
  0  success
  1  command failure
  2  non-interactive prompt required (missing flag) — see error.flag for the fix

Learn more:
  neo <command> --help       detailed help for a command
  neo schema --pretty        full CLI description for agents
`
    )
    .hook('preAction', async (thisCommand, actionCommand) => {
      const opts = thisCommand.opts();
      const commandName = actionCommand.name();

      const overrides: {
        json: boolean;
        yes: boolean;
        nonInteractive: boolean;
        quiet: boolean;
        verbose: boolean;
        color?: boolean;
      } = {
        json: Boolean(opts['json']),
        yes: Boolean(opts['yes']),
        nonInteractive: Boolean(opts['nonInteractive']),
        quiet: Boolean(opts['quiet']),
        verbose: Boolean(opts['verbose']),
      };
      if (opts['color'] === false) overrides.color = false;
      const ctx = buildRuntimeContext(overrides);
      setRuntimeContext(ctx);

      const isHelpOrVersion =
        commandName === 'version' ||
        commandName === 'help' ||
        process.argv.includes('--version') ||
        process.argv.includes('-V') ||
        process.argv.includes('--help') ||
        process.argv.includes('-h');

      // Commands whose stdout is inherently machine-readable — never pollute
      // with banner or update-check, regardless of flags.
      const isMachineOutputCommand =
        commandName === 'schema' || commandName === 'completions';

      if (ctx.verbose) {
        logger.setVerbose(true);
        logger.debug(`Executing command: ${commandName}`);
      }

      if (!ctx.color) {
        chalk.level = 0;
      }

      const suppressBanner =
        ctx.quiet || ctx.format === 'json' || ctx.isAgent || ctx.isCI || isMachineOutputCommand;
      if (!isHelpOrVersion && opts.banner !== false && !suppressBanner) {
        let bannerType: BannerType = 'full';
        try {
          const config = await configManager.read();
          bannerType = config.preferences.banner;
        } catch (error) {
          logger.debug(`Failed to read banner config, using default: ${error}`);
        }

        displayBanner(bannerType);
      }

      if (!isHelpOrVersion && !suppressBanner && !ctx.nonInteractive) {
        await notifyIfCliUpdateAvailable();
      }
    });

  registerCommands(program);

  return program;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.js')) {
  process.on('SIGINT', () => {
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    process.exit(143);
  });

  createCLI()
    .then((program) => {
      if (process.argv.length <= 2) {
        program.help();
      }

      program.exitOverride();

      try {
        program.parse();
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err) {
          if (err.code === 'commander.helpDisplayed' || err.code === 'commander.help') {
            process.exit(0);
          }

          if (err.code === 'commander.version') {
            process.exit(0);
          }

          if (err.code === 'commander.missingArgument' || err.code === 'commander.unknownCommand') {
            console.error(
              `\n${chalk.hex(Colors.error)('Error:')} ${err instanceof Error ? err.message : String(err)}`
            );
            console.log(`\nRun ${chalk.hex(Colors.primary)('neo --help')} for usage information.`);
            process.exit(1);
          }
        }

        const error = err instanceof Error ? err : new Error(String(err));
        logger.error(error.message);
        process.exit(1);
      }
    })
    .catch((err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`CLI initialization failed: ${error.message}`);
      process.exit(1);
    });
}
