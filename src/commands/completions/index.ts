import { Command } from '@commander-js/extra-typings';
import { ui } from '@/utils/ui.js';
import { CompletionGenerator } from '@/utils/completions.js';
import type { ShellType } from '@/utils/completions.js';
import { configManager } from '@/utils/config.js';
import { ZshIntegration, BashIntegration, FishIntegration } from '@/utils/shell.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
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
    .action(runAction(async (shell: string | undefined) => {
      const shellType = (shell ?? detectShell()) as ShellType;

      if (!SUPPORTED_SHELLS.includes(shellType as typeof SUPPORTED_SHELLS[number])) {
        throw new Error(
          `Unsupported shell: ${shellType}. Supported: ${SUPPORTED_SHELLS.join(', ')}`
        );
      }

      const rootProgram = getRootProgram(command);
      const output = CompletionGenerator.generateCompletions(rootProgram, shellType);
      // Completion scripts are the payload of this command — always stdout.
      process.stdout.write(output);
    }));

  command
    .command('install')
    .description('Install completions for the current shell')
    .action(runAction(async () => {
      const shellType = detectShell();
      const rootProgram = getRootProgram(command);

      const completionsPath = join(configManager.getConfigDir(), 'completions');

      const spinner = ui.spinner(`Installing ${shellType} completions`);
      spinner.start();

      try {
        await CompletionGenerator.createCompletionFiles(completionsPath, rootProgram);

        let reload: string;
        switch (shellType) {
          case 'zsh': {
            const zsh = new ZshIntegration();
            await zsh.addCompletions(completionsPath);
            spinner.succeed('ZSH completions installed');
            reload = 'source ~/.zshrc';
            break;
          }
          case 'bash': {
            const bash = new BashIntegration();
            await bash.addCompletions(join(completionsPath, 'neo.bash'));
            spinner.succeed('Bash completions installed');
            reload = 'source ~/.bashrc';
            break;
          }
          case 'fish': {
            const fish = new FishIntegration();
            await fish.addCompletions(join(completionsPath, 'neo.fish'));
            spinner.succeed('Fish completions installed');
            reload = '(auto-loaded in new Fish sessions)';
            break;
          }
        }

        emitJson(
          {
            ok: true,
            command: 'completions.install',
            shell: shellType,
            completionsPath,
          },
          {
            text: () => ui.info(`Restart your terminal or run: ${reload}`),
          }
        );
      } catch (error) {
        spinner.fail('Failed to install completions');
        throw error instanceof Error ? error : new Error(String(error));
      }
    }));

  return command;
}
