import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import { displayBanner } from '@/utils/banner.js';
import type { BannerType } from '@/utils/banner.js';
import { logger } from '@/utils/logger.js';
import { registerCommands } from '@/commands/index.js';
import { configManager } from '@/utils/config.js';
import { notifyIfCliUpdateAvailable } from '@/utils/update-check.js';
import { Colors } from '@/utils/ui-types.js';
import { pluginRegistry, commandRegistry, eventBus } from '@/core/plugins/index.js';
import { CliEvents } from '@/core/interfaces/index.js';
import type { CliStartEvent, CommandBeforeEvent, CommandAfterEvent, CliExitEvent, CliErrorEvent } from '@/core/interfaces/index.js';
import { success } from '@/core/errors/index.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { runAction } from '@/utils/run-action.js';
import { emitError } from '@/utils/output.js';
import packageJson from '../package.json' with { type: 'json' };

// Track if plugins are loaded
let pluginsLoaded = false;

// Track command start time for duration calculation
let commandStartTime: number = 0;

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

      // Build the runtime context from flags + env. All downstream code
      // (logger, prompts, banner, commands) consults this instead of re-reading flags.
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

      // Commands whose stdout is inherently machine-readable — never polute
      // with banner or update-check, regardless of flags.
      const isMachineOutputCommand =
        commandName === 'schema' || commandName === 'completions';

      // Configure logger early
      if (ctx.verbose) {
        logger.setVerbose(true);
        logger.debug(`Executing command: ${commandName}`);
      }

      // Disable colors if requested or auto-detected (NO_COLOR, non-TTY, json mode)
      if (!ctx.color) {
        chalk.level = 0;
      }

      // Skip banner for help/version, machine commands, --no-banner, or agent/json/quiet.
      const suppressBanner =
        ctx.quiet || ctx.format === 'json' || ctx.isAgent || ctx.isCI || isMachineOutputCommand;
      if (!isHelpOrVersion && opts.banner !== false && !suppressBanner) {
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
      }

      // Update check: only when interactive, not in json/quiet/agent/CI mode.
      // Under those modes we don't want background network I/O or stdout noise.
      if (!isHelpOrVersion && !suppressBanner && !ctx.nonInteractive) {
        await notifyIfCliUpdateAvailable();
      }

      // Track command start time
      commandStartTime = Date.now();

      // Emit command:before event
      eventBus.emit<CommandBeforeEvent>(CliEvents.COMMAND_BEFORE, {
        command: commandName,
        options: opts,
      });

      // Execute plugin beforeCommand hooks
      if (pluginsLoaded) {
        await pluginRegistry.executeBeforeCommand(commandName, opts);
      }
    })
    .hook('postAction', async (_thisCommand, actionCommand) => {
      const commandName = actionCommand.name();
      const duration = Date.now() - commandStartTime;

      // Emit command:after event
      eventBus.emit<CommandAfterEvent>(CliEvents.COMMAND_AFTER, {
        command: commandName,
        success: true,
        duration,
      });

      // Execute plugin afterCommand hooks
      if (pluginsLoaded) {
        await pluginRegistry.executeAfterCommand(commandName, success(undefined));
      }
    });

  // Register all built-in commands
  registerCommands(program);

  // Load and initialize plugins
  try {
    const config = await configManager.read();
    const pluginsEnabled = config.plugins?.enabled !== false;

    if (pluginsEnabled) {
      const disabledPlugins = config.plugins?.disabled ?? [];
      await pluginRegistry.loadPlugins(disabledPlugins);
      pluginsLoaded = true;

      // Register plugin commands with Commander
      for (const command of commandRegistry.getAll()) {
        const cmd = new Command(command.name);
        cmd.description(command.description);

        // Add options
        if (command.options) {
          for (const opt of command.options) {
            if (opt.required) {
              cmd.requiredOption(opt.flags, opt.description, opt.defaultValue as string);
            } else {
              cmd.option(opt.flags, opt.description, opt.defaultValue as string);
            }
          }
        }

        // Add arguments
        if (command.arguments) {
          for (const arg of command.arguments) {
            if (arg.required) {
              cmd.argument(`<${arg.name}>`, arg.description);
            } else {
              cmd.argument(`[${arg.name}]`, arg.description);
            }
          }
        }

        // Add action. Plugins get the same NonInteractiveError / --json
        // guarantees as built-in commands via the shared runAction wrapper.
        cmd.action(
          runAction(async (...args: unknown[]) => {
            const opts = args[args.length - 2] as unknown;
            const cmdArgs = args.slice(0, -2) as string[];

            if (command.validate && !command.validate(opts)) {
              emitError(new Error(`Invalid options for command "${command.name}"`));
              process.exit(1);
            }

            const result = await command.execute(opts, cmdArgs);
            if (!result.success) {
              emitError(result.error as unknown as Error);
              process.exit(1);
            }
          })
        );

        program.addCommand(cmd);
        logger.debug(`Registered plugin command: ${command.name}`);
      }

      if (pluginRegistry.size > 0) {
        logger.debug(`Loaded ${pluginRegistry.size} plugin(s)`);
      }
    }
  } catch (error) {
    logger.debug(`Plugin loading failed: ${error}`);
    // Continue without plugins
  }

  return program;
}

// Cleanup function for graceful shutdown
async function cleanup(code: number, reason: 'normal' | 'error' | 'signal' = 'normal'): Promise<void> {
  // Emit cli:exit event
  eventBus.emit<CliExitEvent>(CliEvents.CLI_EXIT, { code, reason });

  if (pluginsLoaded) {
    await pluginRegistry.executeOnExit(code);
    await pluginRegistry.disposeAll();
  }
}

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.js')) {
  // Handle process exit
  process.on('beforeExit', async (code) => {
    await cleanup(code);
  });

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', async () => {
    await cleanup(130, 'signal');
    process.exit(130);
  });

  // Handle SIGTERM
  process.on('SIGTERM', async () => {
    await cleanup(143, 'signal');
    process.exit(143);
  });

  createCLI()
    .then(async (program) => {
      // Emit cli:start event
      eventBus.emit<CliStartEvent>(CliEvents.CLI_START, {
        version: packageJson.version,
        args: process.argv.slice(2),
      });

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
              `\n${chalk.hex(Colors.error)('Error:')} ${err instanceof Error ? err.message : String(err)}`
            );
            console.log(`\nRun ${chalk.hex(Colors.primary)('neo --help')} for usage information.`);
            process.exit(1);
          }
        }

        const error = err instanceof Error ? err : new Error(String(err));
        eventBus.emit<CliErrorEvent>(CliEvents.CLI_ERROR, { error });
        logger.error(error.message);
        await cleanup(1, 'error');
        process.exit(1);
      }
    })
    .catch(async (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      eventBus.emit<CliErrorEvent>(CliEvents.CLI_ERROR, { error });
      logger.error(`CLI initialization failed: ${error.message}`);
      await cleanup(1, 'error');
      process.exit(1);
    });
}
