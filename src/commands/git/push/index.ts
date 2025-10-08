import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { logger } from '@/utils/logger.js';
import { ui } from '@/utils/ui.js';
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
      const spinner = ui.spinner('Pushing to remote');

      try {
        const { stdout: currentBranch } = await execa('git', ['branch', '--show-current']);
        branchName = currentBranch.trim();

        logger.debug(`Current branch: ${branchName}`);

        if (branchName === 'main') {
          ui.warn('You are about to push directly to main branch');
          ui.muted('This is generally not recommended as it bypasses code review processes');

          const { confirmPush } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirmPush',
              message: 'Are you sure you want to continue?',
              default: false,
            },
          ]);

          if (!confirmPush) {
            ui.success("Push cancelled. Here's how to push your changes safely:");
            ui.list([
              'Create a feature branch: git checkout -b feature/your-feature-name',
              'Push to your branch: git push -u origin feature/your-feature-name',
              'Create a pull request to merge into main',
            ]);
            ui.muted('This protects the main branch from accidental changes');
            process.exit(0);
          }

          ui.step('Proceeding with push to main branch');
        }

        spinner.start();

        logger.debug(`Force push: ${options.force || false}`);
        logger.debug(`Set upstream: ${options.setUpstream || 'none'}`);
        logger.debug(`Dry run: ${options.dryRun || false}`);
        logger.debug(`Push tags: ${options.tags || false}`);

        if (options.dryRun) {
          spinner.stop();
          ui.warn('Dry run mode - no changes will be pushed');
          ui.info(`Would push from branch: ${branchName}`);

          // Show what would be pushed
          try {
            const { stdout: commits } = await execa('git', [
              'log',
              '--oneline',
              `origin/${branchName}..HEAD`,
            ]);
            if (commits.trim()) {
              ui.info('Would push the following commits:');
              ui.list(commits.trim().split('\n'));
            } else {
              ui.info('No new commits to push');
            }
          } catch {
            ui.info('Would push current branch (unable to determine commit differences)');
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

        spinner.succeed('Successfully pushed to remote!');

        if (pushResult.stdout) {
          ui.muted(pushResult.stdout);
        }

        if (options.setUpstream) {
          ui.info(`Set upstream branch: ${options.setUpstream}`);
        }
      } catch (error: unknown) {
        spinner.stop();

        if (error instanceof Error) {
          if (error.message?.includes('not a git repository')) {
            ui.error('Not a git repository!');
            ui.warn('Make sure you are in a git repository directory');
            process.exit(1);
          }

          if (error.message?.includes('no upstream branch')) {
            ui.error('No upstream branch configured!');
            ui.warn('Use --set-upstream to set the upstream branch:');
            ui.muted(`  git push -u origin ${branchName || 'your-branch'}`);
            process.exit(1);
          }

          if (error.message?.includes('rejected')) {
            ui.error('Push was rejected!');
            ui.warn('The remote branch has changes that conflict with your local branch');
            ui.muted('Try pulling the latest changes first:');
            ui.muted(`  git pull origin ${branchName || 'your-branch'}`);
            ui.muted('Or use --force to overwrite (use with caution):');
            ui.muted('  git push --force');
            process.exit(1);
          }

          if (error.message?.includes('authentication')) {
            ui.error('Authentication failed!');
            ui.warn('Check your git credentials or SSH keys');
            process.exit(1);
          }
        }

        ui.error('Failed to push to remote');
        ui.muted(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return command;
}
