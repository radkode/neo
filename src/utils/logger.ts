import chalk from 'chalk';
import { Colors } from './ui-types.js';
import { getRuntimeContext } from './runtime-context.js';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

class Logger {
  private level: LogLevel = LogLevel.INFO;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setVerbose(verbose: boolean): void {
    this.level = verbose ? LogLevel.DEBUG : LogLevel.INFO;
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (this.level > LogLevel.INFO) return;
    const ctx = getRuntimeContext();
    if (ctx.quiet) return;
    if (ctx.format === 'json') {
      this.emitJsonLog('info', message, context);
      return;
    }
    // Diagnostic output: stderr, not stdout. Keeps stdout clean for data.
    process.stderr.write(
      `${chalk.hex(Colors.muted)('ℹ')} ${this.formatMessage(message, context)}\n`
    );
  }

  success(message: string, context?: Record<string, unknown>): void {
    if (this.level > LogLevel.INFO) return;
    const ctx = getRuntimeContext();
    if (ctx.quiet) return;
    if (ctx.format === 'json') {
      this.emitJsonLog('success', message, context);
      return;
    }
    process.stderr.write(
      `${chalk.hex(Colors.success)('✓')} ${this.formatMessage(message, context)}\n`
    );
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (this.level > LogLevel.WARN) return;
    const ctx = getRuntimeContext();
    if (ctx.format === 'json') {
      this.emitJsonLog('warn', message, context);
      return;
    }
    process.stderr.write(
      `${chalk.hex(Colors.error)('⚠')} ${this.formatMessage(message, context)}\n`
    );
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (this.level > LogLevel.ERROR) return;
    const ctx = getRuntimeContext();
    if (ctx.format === 'json') {
      this.emitJsonLog('error', message, context);
      return;
    }
    process.stderr.write(
      `${chalk.hex(Colors.error)('✖')} ${this.formatMessage(message, context)}\n`
    );
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (this.level > LogLevel.DEBUG) return;
    const ctx = getRuntimeContext();
    if (ctx.format === 'json') {
      this.emitJsonLog('debug', message, context);
      return;
    }
    process.stderr.write(
      `${chalk.hex(Colors.muted)('[DEBUG]')} ${this.formatMessage(message, context)}\n`
    );
  }

  log(message: string): void {
    // Raw passthrough — commands that want guaranteed stdout output.
    process.stdout.write(`${message}\n`);
  }

  private emitJsonLog(
    level: 'debug' | 'info' | 'success' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>
  ): void {
    const payload: Record<string, unknown> = {
      level,
      message,
      ts: new Date().toISOString(),
    };
    if (context && Object.keys(context).length > 0) {
      payload['context'] = context;
    }
    // NDJSON on stderr so stdout remains reserved for command data.
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  }

  private formatMessage(message: string, context?: Record<string, unknown>): string {
    if (!context || Object.keys(context).length === 0) {
      return message;
    }
    return `${message} ${chalk.hex(Colors.muted)(JSON.stringify(context))}`;
  }
}

export const logger = new Logger();
