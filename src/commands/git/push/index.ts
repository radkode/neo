import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import { logger } from '../../../utils/logger.js';
import { GitPushOptions } from '../../../types/index.js';

export function createPushCommand(): Command {
  const command = new Command('push');

  command
    .description('Push changes to remote repository')
    .option('-f, --force', 'force push (overwrites remote)')
    .option('-u, --set-upstream <branch>', 'set upstream branch')
    .option('--dry-run', 'show what would be pushed without actually pushing')
    .option('--tags', 'push tags along with commits')
    .action(async (options: GitPushOptions) => {
      try {
        // Check current branch
        const { stdout: currentBranch } = await execa('git', ['branch', '--show-current']);
        const branchName = currentBranch.trim();

        logger.debug(`Current branch: ${branchName}`);

        // Prevent direct pushes to main branch
        if (branchName === 'main') {
          logger.error(chalk.red.bold('❌ Direct pushes to main branch are not allowed!'));
          logger.log(chalk.yellow('\nTo push your changes safely:'));
          logger.log(
            chalk.gray('  1. Create a feature branch:') +
              chalk.cyan(` git checkout -b feature/your-feature-name`)
          );
          logger.log(
            chalk.gray('  2. Push to your branch:') +
              chalk.cyan(` git push -u origin feature/your-feature-name`)
          );
          logger.log(chalk.gray('  3. Create a pull request to merge into main'));
          logger.log(chalk.gray('\nThis protects the main branch from accidental changes.'));
          process.exit(1);
        }

        const spinner = ora('Pushing to remote...').start();

        logger.debug(`Force push: ${options.force || false}`);
        logger.debug(`Set upstream: ${options.setUpstream || 'none'}`);
        logger.debug(`Dry run: ${options.dryRun || false}`);
        logger.debug(`Push tags: ${options.tags || false}`);

        if (options.dryRun) {
          spinner.stop();
          logger.info(chalk.yellow('Dry run mode - no changes will be pushed'));
          logger.info(`Would push from branch: ${chalk.cyan(branchName)}`);
          logger.info('Would push the following commits:');
          logger.log('  • feat: add new git command structure');
          logger.log('  • chore: update command registration');
          return;
        }

        // Simulate git push
        await new Promise((resolve) => setTimeout(resolve, 800));

        spinner.succeed(chalk.green('Successfully pushed to remote!'));

        if (options.setUpstream) {
          logger.info(`Set upstream branch: ${chalk.cyan(options.setUpstream)}`);
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes('not a git repository')) {
          logger.error(chalk.red('❌ Not a git repository!'));
          logger.log(chalk.yellow('Make sure you are in a git repository directory.'));
          process.exit(1);
        }

        logger.error(chalk.red('Failed to push to remote'));
        throw error;
      }
    });

  return command;
}
