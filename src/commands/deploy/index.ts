import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import { logger } from '../../utils/logger.js';
import { DeployOptions } from '../../types/index.js';

export function createDeployCommand(): Command {
  const command = new Command('deploy');

  command
    .description('Deploy the project')
    .argument('[environment]', 'deployment environment', 'development')
    .option('--dry-run', 'perform a dry run without deploying')
    .option('--skip-build', 'skip the build step')
    .option('--force', 'force deployment without confirmation')
    .action(async (environment: string, options: DeployOptions) => {
      const spinner = ora(`Deploying to ${environment}...`).start();

      try {
        logger.debug(`Environment: ${environment}`);
        logger.debug(`Dry run: ${options.dryRun || false}`);
        
        if (!options.skipBuild) {
          spinner.text = 'Building project...';
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        spinner.text = `Deploying to ${environment}...`;
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        if (options.dryRun) {
          spinner.info(chalk.yellow('Dry run completed (no actual deployment)'));
        } else {
          spinner.succeed(chalk.green(`Successfully deployed to ${environment}!`));
        }

      } catch (error: any) {
        spinner.fail(`Deployment to ${environment} failed`);
        throw error;
      }
    });

  return command;
}
