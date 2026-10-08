import { readFile } from 'node:fs/promises';
import { constants } from 'node:os';
import { dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { findUp } from 'find-up';
import { runAction } from '@/utils/run-action.js';

async function findPnpmEnvFile(): Promise<string | undefined> {
  const cwd = process.cwd();
  const gitMarker = await findUp('.git', { cwd, type: 'both' });
  return findUp('.env.pnpm.local', { cwd, stopAt: gitMarker ? dirname(gitMarker) : cwd });
}

export function createPnpmCommand(): Command {
  const command = new Command('pnpm');
  command
    .description('Run pnpm with environment variables scoped to its child process')
    .option('--env-file <path>', 'override automatic repository-local .env.pnpm.local discovery')
    .argument('[args...]', 'pnpm arguments; put -- before these to forward options unchanged')
    .addHelpText('after', '\nExample: neo pnpm -- install --frozen-lockfile')
    .action(
      runAction(async (args: string[], options: { envFile?: string }) => {
        const envFile = options.envFile ?? (await findPnpmEnvFile());
        let env: NodeJS.ProcessEnv = {};
        if (envFile) {
          try {
            env = parseEnv(await readFile(envFile, 'utf8'));
          } catch {
            throw new Error(
              'Unable to read environment file. Check the path and file permissions.'
            );
          }
        }

        let result;
        try {
          result = await execa('pnpm', args, { env, stdio: 'inherit', reject: false });
        } catch {
          throw new Error(
            'Unable to start pnpm. Check that it is installed and available on PATH.'
          );
        }

        if (result.failed) {
          process.exitCode = result.signal
            ? 128 + constants.signals[result.signal]
            : (result.exitCode ?? 1);
        }
      })
    );
  return command;
}
