import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { logger } from '@/utils/logger.js';
import { ui } from '@/utils/ui.js';
import { GitPullOptions } from '@/types/index.js';

/**
 * Create the git pull command
 *
 * This command attempts a normal pull first, and if it fails due to
 * non-fast-forward issues, automatically retries with --rebase
 *
 * @returns Command instance for git pull
 */
export function createPullCommand(): Command {
  const command = new Command('pull');

  command
    .description('Pull changes from remote repository with automatic rebase fallback')
    .option('--rebase', 'force rebase strategy')
    .option('--no-rebase', 'prevent automatic rebase fallback')
    .action(async (options: GitPullOptions) => {
      const spinner = ui.spinner('Pulling from remote');

      try {
        // Get current branch name
        const { stdout: currentBranch } = await execa('git', ['branch', '--show-current']);
        const branchName = currentBranch.trim();

        logger.debug(`Current branch: ${branchName}`);

        // Check if branch has an upstream
        try {
          await execa('git', ['rev-parse', '--abbrev-ref', '@{u}']);
        } catch {
          ui.error('No upstream branch configured!');
          ui.warn('Set an upstream branch first:');
          ui.muted(`  git branch --set-upstream-to=origin/${branchName} ${branchName}`);
          ui.muted('Or push with upstream:');
          ui.muted(`  neo git push -u ${branchName}`);
          process.exit(1);
        }

        spinner.start();

        // If user explicitly requested rebase, use it directly
        if (options.rebase) {
          logger.debug('Using rebase strategy (user specified)');
          spinner.text = 'Pulling with rebase...';

          const { stdout } = await execa('git', ['pull', '--rebase'], {
            stdio: 'pipe',
            encoding: 'utf8',
          });

          spinner.succeed('Successfully pulled with rebase!');

          if (stdout.trim()) {
            ui.muted(stdout);
          }

          return;
        }

        // Try normal pull first
        logger.debug('Attempting normal pull...');

        try {
          const { stdout } = await execa('git', ['pull'], {
            stdio: 'pipe',
            encoding: 'utf8',
          });

          spinner.succeed('Successfully pulled from remote!');

          if (stdout.trim()) {
            ui.muted(stdout);
          }
        } catch (error: unknown) {
          // Check if it's a non-fast-forward error
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (
            (errorMessage.includes('non-fast-forward') ||
              errorMessage.includes('divergent branches') ||
              errorMessage.includes('cannot fast-forward')) &&
            !options.noRebase
          ) {
            logger.debug('Normal pull failed, attempting rebase...');
            spinner.text = 'Cannot fast-forward, retrying with rebase...';

            const { stdout } = await execa('git', ['pull', '--rebase'], {
              stdio: 'pipe',
              encoding: 'utf8',
            });

            spinner.succeed('Successfully pulled with rebase!');
            ui.info('Used rebase strategy due to divergent branches');

            if (stdout.trim()) {
              ui.muted(stdout);
            }
          } else {
            throw error; // Re-throw if not a fast-forward issue
          }
        }
      } catch (error: unknown) {
        spinner.stop();

        if (error instanceof Error) {
          const errorMessage = error.message;

          if (errorMessage.includes('not a git repository')) {
            ui.error('Not a git repository!');
            ui.warn('Make sure you are in a git repository directory');
            process.exit(1);
          }

          if (errorMessage.includes('conflict')) {
            ui.error('Merge conflicts detected!');
            ui.warn('Resolve conflicts manually, then:');
            ui.list([
              'Fix conflicts in your editor',
              'Stage resolved files: git add <files>',
              'Continue rebase: git rebase --continue',
            ]);
            ui.muted('Or abort the rebase:');
            ui.muted('  git rebase --abort');
            process.exit(1);
          }

          if (errorMessage.includes('authentication') || errorMessage.includes('permission')) {
            ui.error('Authentication failed!');
            ui.warn('Check your git credentials or SSH keys');
            process.exit(1);
          }

          if (errorMessage.includes('Could not resolve host')) {
            ui.error('Network error!');
            ui.warn('Check your internet connection');
            process.exit(1);
          }
        }

        ui.error('Failed to pull from remote');
        ui.muted(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return command;
}
