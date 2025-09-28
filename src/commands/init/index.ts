import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import { logger } from '../../utils/logger.js';
import { InitOptions } from '../../types/index.js';

export function createInitCommand(): Command {
  const command = new Command('init');

  command
    .description('Initialize a new project')
    .argument('[name]', 'project name', 'my-project')
    .option('-t, --template <type>', 'project template', 'default')
    .option('--skip-install', 'skip dependency installation')
    .option('--force', 'overwrite existing files')
    .action(async (name: string, options: InitOptions) => {
      const spinner = ora('Initializing project...').start();

      try {
        logger.debug(`Creating project: ${name}`);
        logger.debug(`Template: ${options.template}`);
        
        // Simulate project creation
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        spinner.succeed(chalk.green('Project initialized successfully!'));
        
        logger.info(`\nProject created: ${chalk.cyan(name)}`);
        logger.info('\nNext steps:');
        logger.log(`  ${chalk.gray('$')} cd ${name}`);
        if (!options.skipInstall) {
          logger.log(`  ${chalk.gray('$')} pnpm install`);
        }
        logger.log(`  ${chalk.gray('$')} pnpm run dev`);

      } catch (error: any) {
        spinner.fail('Failed to initialize project');
        throw error;
      }
    });

  return command;
}
