import chalk from 'chalk';
import { Colors } from './ui-types.js';

class Logger {
  private verbose: boolean = false;

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  info(message: string): void {
    console.log(chalk.hex(Colors.muted)('ℹ'), message);
  }

  success(message: string): void {
    console.log(chalk.hex(Colors.success)('✓'), message);
  }

  warn(message: string): void {
    console.log(chalk.hex(Colors.error)('⚠'), message);
  }

  error(message: string): void {
    console.error(chalk.hex(Colors.error)('✖'), message);
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(chalk.hex(Colors.muted)('[DEBUG]'), message);
    }
  }

  log(message: string): void {
    console.log(message);
  }
}

export const logger = new Logger();
