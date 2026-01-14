import chalk from 'chalk';
import { Colors } from './ui-types.js';
import { type ILogger, LogLevel } from '@/core/interfaces/index.js';

class Logger implements ILogger {
  private level: LogLevel = LogLevel.INFO;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Backwards-compatible method for setting verbose/debug mode
   */
  setVerbose(verbose: boolean): void {
    this.level = verbose ? LogLevel.DEBUG : LogLevel.INFO;
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.INFO) {
      console.log(chalk.hex(Colors.muted)('ℹ'), this.formatMessage(message, context));
    }
  }

  success(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.INFO) {
      console.log(chalk.hex(Colors.success)('✓'), this.formatMessage(message, context));
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.WARN) {
      console.log(chalk.hex(Colors.error)('⚠'), this.formatMessage(message, context));
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(chalk.hex(Colors.error)('✖'), this.formatMessage(message, context));
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(chalk.hex(Colors.muted)('[DEBUG]'), this.formatMessage(message, context));
    }
  }

  log(message: string): void {
    console.log(message);
  }

  private formatMessage(message: string, context?: Record<string, unknown>): string {
    if (!context || Object.keys(context).length === 0) {
      return message;
    }
    return `${message} ${chalk.hex(Colors.muted)(JSON.stringify(context))}`;
  }
}

export const logger = new Logger();
