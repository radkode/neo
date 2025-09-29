import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { GitPushOptions } from '@/types/index.js';

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

        // Confirm direct pushes to main branch
        if (branchName === 'main') {
          logger.log(chalk.yellow.bold('⚠️  You are about to push directly to the main branch.'));
          logger.log(
            chalk.gray('This is generally not recommended as it bypasses code review processes.')
          );

          const { confirmPush } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirmPush',
              message: 'Are you sure you want to continue?',
              default: false,
            },
          ]);

          if (!confirmPush) {
            logger.log(chalk.green("\n✅ Push cancelled. Here's how to push your changes safely:"));
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
            process.exit(0);
          }

          logger.log(chalk.blue('\n→ Proceeding with push to main branch...'));
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
