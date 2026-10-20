import { readFile } from 'node:fs/promises';
import { constants } from 'node:os';
import { dirname } from 'node:path';
import { parseEnv } from 'node:util';
import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { findUp } from 'find-up';
import { runAction } from '@/utils/run-action.js';

export interface ScopedEnvCommandOptions {
  /** Executable to run, also the subcommand name and the `.env.<tool>.local` convention. */
  tool: 'pnpm' | 'yarn';
  /** Arguments shown in the help example, after `--`. */
  example: string;
}

async function findEnvFile(fileName: string): Promise<string | undefined> {
  const cwd = process.cwd();
  const gitMarker = await findUp('.git', { cwd, type: 'both' });
  return findUp(fileName, { cwd, stopAt: gitMarker ? dirname(gitMarker) : cwd });
}

/**
 * Creates a command that runs a package manager with the nearest repository-local
 * `.env.<tool>.local` (or an explicit --env-file) loaded only into its child process.
 */
export function createScopedEnvCommand({ tool, example }: ScopedEnvCommandOptions): Command {
  const envFileName = `.env.${tool}.local`;
  const command = new Command(tool);
  command
    .description(`Run ${tool} with environment variables scoped to its child process`)
    .option('--env-file <path>', `override automatic repository-local ${envFileName} discovery`)
    .argument('[args...]', `${tool} arguments; put -- before these to forward options unchanged`)
    .addHelpText('after', `\nExample: neo ${tool} -- ${example}`)
    .action(
      runAction(async (args: string[], options: { envFile?: string }) => {
        const envFile = options.envFile ?? (await findEnvFile(envFileName));
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
          result = await execa(tool, args, { env, stdio: 'inherit', reject: false });
        } catch {
          throw new Error(
            `Unable to start ${tool}. Check that it is installed and available on PATH.`
          );
        }

        if (result.failed) {
          if (result.exitCode === undefined && !result.signal) {
            throw new Error(
              `Unable to start ${tool}. Check that it is installed and available on PATH.`
            );
          }
          process.exitCode = result.signal
            ? 128 + constants.signals[result.signal]
            : (result.exitCode ?? 1);
        }
      })
    );
  return command;
}
