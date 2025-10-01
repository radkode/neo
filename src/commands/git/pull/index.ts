import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import { logger } from '@/utils/logger.js';
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
      const spinner = ora('Pulling from remote...');

      try {
        // Get current branch name
        const { stdout: currentBranch } = await execa('git', ['branch', '--show-current']);
        const branchName = currentBranch.trim();

        logger.debug(`Current branch: ${branchName}`);

        // Check if branch has an upstream
        try {
          await execa('git', ['rev-parse', '--abbrev-ref', '@{u}']);
        } catch {
          logger.error(chalk.red('❌ No upstream branch configured!'));
          logger.log(chalk.yellow('Set an upstream branch first:'));
          logger.log(
            chalk.cyan(`  git branch --set-upstream-to=origin/${branchName} ${branchName}`)
          );
          logger.log(chalk.gray('Or push with upstream:'));
          logger.log(chalk.cyan(`  neo git push -u ${branchName}`));
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

          spinner.succeed(chalk.green('✅ Successfully pulled with rebase!'));

          if (stdout.trim()) {
            logger.log(chalk.gray(stdout));
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

          spinner.succeed(chalk.green('✅ Successfully pulled from remote!'));

          if (stdout.trim()) {
            logger.log(chalk.gray(stdout));
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

            spinner.succeed(chalk.green('✅ Successfully pulled with rebase!'));
            logger.log(chalk.yellow('ℹ️  Used rebase strategy due to divergent branches'));

            if (stdout.trim()) {
              logger.log(chalk.gray(stdout));
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
            logger.error(chalk.red('❌ Not a git repository!'));
            logger.log(chalk.yellow('Make sure you are in a git repository directory.'));
            process.exit(1);
          }

          if (errorMessage.includes('conflict')) {
            logger.error(chalk.red('❌ Merge conflicts detected!'));
            logger.log(chalk.yellow('Resolve conflicts manually, then:'));
            logger.log(chalk.cyan('  1. Fix conflicts in your editor'));
            logger.log(chalk.cyan('  2. Stage resolved files: git add <files>'));
            logger.log(chalk.cyan('  3. Continue rebase: git rebase --continue'));
            logger.log(chalk.gray('Or abort the rebase:'));
            logger.log(chalk.cyan('  git rebase --abort'));
            process.exit(1);
          }

          if (errorMessage.includes('authentication') || errorMessage.includes('permission')) {
            logger.error(chalk.red('❌ Authentication failed!'));
            logger.log(chalk.yellow('Check your git credentials or SSH keys.'));
            process.exit(1);
          }

          if (errorMessage.includes('Could not resolve host')) {
            logger.error(chalk.red('❌ Network error!'));
            logger.log(chalk.yellow('Check your internet connection.'));
            process.exit(1);
          }
        }

        logger.error(chalk.red('❌ Failed to pull from remote'));
        logger.error(chalk.gray(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  return command;
}
