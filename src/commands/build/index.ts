import { Command } from '@commander-js/extra-typings';
import chalk from 'chalk';
import ora from 'ora';
import { logger } from '../../utils/logger.js';
import { BuildOptions } from '../../types/index.js';

export function createBuildCommand(): Command {
  const command = new Command('build');

  command
    .description('Build the project')
    .option('-w, --watch', 'watch for changes')
    .option('-m, --minify', 'minify output')
    .option('--source-maps', 'generate source maps')
    .option('-o, --output <dir>', 'output directory', 'dist')
    .action(async (options: BuildOptions) => {
      const spinner = ora('Building project...').start();

      try {
        logger.debug(`Output directory: ${options.output}`);
        logger.debug(`Minify: ${options.minify || false}`);
        logger.debug(`Source maps: ${options.sourceMaps || false}`);
        
        // Simulate build
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        spinner.succeed(chalk.green('Build completed successfully!'));
        
        if (options.watch) {
          logger.info(chalk.yellow('\n👁  Watching for changes...'));
        }

      } catch (error: any) {
        spinner.fail('Build failed');
        throw error;
      }
    });

  return command;
}
