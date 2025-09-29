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
      let branchName: string = '';
      const spinner = ora('Pushing to remote...');

      try {
        const { stdout: currentBranch } = await execa('git', ['branch', '--show-current']);
        branchName = currentBranch.trim();

        logger.debug(`Current branch: ${branchName}`);

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

        spinner.start();

        logger.debug(`Force push: ${options.force || false}`);
        logger.debug(`Set upstream: ${options.setUpstream || 'none'}`);
        logger.debug(`Dry run: ${options.dryRun || false}`);
        logger.debug(`Push tags: ${options.tags || false}`);

        if (options.dryRun) {
          spinner.stop();
          logger.info(chalk.yellow('Dry run mode - no changes will be pushed'));
          logger.info(`Would push from branch: ${chalk.cyan(branchName)}`);

          // Show what would be pushed
          try {
            const { stdout: commits } = await execa('git', [
              'log',
              '--oneline',
              `origin/${branchName}..HEAD`,
            ]);
            if (commits.trim()) {
              logger.info('Would push the following commits:');
              commits
                .trim()
                .split('\n')
                .forEach((commit) => {
                  logger.log(`  • ${commit}`);
                });
            } else {
              logger.info('No new commits to push');
            }
          } catch {
            logger.info('Would push current branch (unable to determine commit differences)');
          }
          return;
        }

        const pushArgs = ['push'];

        if (options.force) {
          pushArgs.push('--force');
        }

        if (options.tags) {
          pushArgs.push('--tags');
        }

        if (options.setUpstream) {
          pushArgs.push('-u', 'origin', options.setUpstream);
        } else {
          pushArgs.push('origin', branchName);
        }

        logger.debug(`Executing: git ${pushArgs.join(' ')}`);

        const pushResult = await execa('git', pushArgs, {
          stdio: 'pipe',
          encoding: 'utf8',
        });

        spinner.succeed(chalk.green('Successfully pushed to remote!'));

        if (pushResult.stdout) {
          logger.log(chalk.gray(pushResult.stdout));
        }

        if (options.setUpstream) {
          logger.info(`Set upstream branch: ${chalk.cyan(options.setUpstream)}`);
        }
      } catch (error: unknown) {
        spinner.stop();

        if (error instanceof Error) {
          if (error.message?.includes('not a git repository')) {
            logger.error(chalk.red('❌ Not a git repository!'));
            logger.log(chalk.yellow('Make sure you are in a git repository directory.'));
            process.exit(1);
          }

          if (error.message?.includes('no upstream branch')) {
            logger.error(chalk.red('❌ No upstream branch configured!'));
            logger.log(chalk.yellow('Use --set-upstream to set the upstream branch:'));
            logger.log(chalk.cyan(`  git push -u origin ${branchName || 'your-branch'}`));
            process.exit(1);
          }

          if (error.message?.includes('rejected')) {
            logger.error(chalk.red('❌ Push was rejected!'));
            logger.log(
              chalk.yellow('The remote branch has changes that conflict with your local branch.')
            );
            logger.log(chalk.gray('Try pulling the latest changes first:'));
            logger.log(chalk.cyan(`  git pull origin ${branchName || 'your-branch'}`));
            logger.log(chalk.gray('Or use --force to overwrite (use with caution):'));
            logger.log(chalk.cyan('  git push --force'));
            process.exit(1);
          }

          if (error.message?.includes('authentication')) {
            logger.error(chalk.red('❌ Authentication failed!'));
            logger.log(chalk.yellow('Check your git credentials or SSH keys.'));
            process.exit(1);
          }
        }

        logger.error(chalk.red('❌ Failed to push to remote'));
        logger.error(chalk.gray(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  return command;
}
