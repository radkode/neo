import { Command } from '@commander-js/extra-typings';
import { logger } from '@/utils/logger.js';
import { ui } from '@/utils/ui.js';
import { CompletionGenerator } from '@/utils/completions.js';
import type { ShellType } from '@/utils/completions.js';
import { configManager } from '@/utils/config.js';
import { ZshIntegration, BashIntegration, FishIntegration } from '@/utils/shell.js';
import { join } from 'path';

const SUPPORTED_SHELLS = ['zsh', 'bash', 'fish'] as const;

function detectShell(): ShellType {
  const shell = process.env['SHELL'] ?? '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('bash')) return 'bash';
  return 'zsh'; // default
}

function getRootProgram(command: Command): Command {
  let current: Command = command;
  while (current.parent) {
    current = current.parent as Command;
  }
  return current;
}

export function createCompletionsCommand(): Command {
  const command = new Command('completions');

  command
    .description('Generate or install shell completions')
    .argument('[shell]', 'shell type (zsh, bash, fish)')
    .action(async (shell: string | undefined) => {
      const shellType = (shell ?? detectShell()) as ShellType;

      if (!SUPPORTED_SHELLS.includes(shellType as typeof SUPPORTED_SHELLS[number])) {
        ui.error(`Unsupported shell: ${shellType}. Supported: ${SUPPORTED_SHELLS.join(', ')}`);
        process.exit(1);
      }

      const rootProgram = getRootProgram(command);
      const output = CompletionGenerator.generateCompletions(rootProgram, shellType);
      process.stdout.write(output);
    });

  command
    .command('install')
    .description('Install completions for the current shell')
    .action(async () => {
      const shellType = detectShell();
      const rootProgram = getRootProgram(command);

      const completionsPath = join(configManager.getConfigDir(), 'completions');

      const spinner = ui.spinner(`Installing ${shellType} completions`);
      spinner.start();

      try {
        // Generate and write all completion files
        await CompletionGenerator.createCompletionFiles(completionsPath, rootProgram);

        // Set up shell integration
        switch (shellType) {
          case 'zsh': {
            const zsh = new ZshIntegration();
            await zsh.addCompletions(completionsPath);
            spinner.succeed('ZSH completions installed');
            ui.info('Restart your terminal or run: source ~/.zshrc');
            break;
          }
          case 'bash': {
            const bash = new BashIntegration();
            await bash.addCompletions(join(completionsPath, 'neo.bash'));
            spinner.succeed('Bash completions installed');
            ui.info('Restart your terminal or run: source ~/.bashrc');
            break;
          }
          case 'fish': {
            const fish = new FishIntegration();
            await fish.addCompletions(join(completionsPath, 'neo.fish'));
            spinner.succeed('Fish completions installed');
            ui.info('Completions are available immediately in new Fish sessions');
            break;
          }
        }
      } catch (error) {
        spinner.fail('Failed to install completions');
        logger.error(`${error}`);
        process.exit(1);
      }
    });

  return command;
}
