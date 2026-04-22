import chalk from 'chalk';
import ora from 'ora';
import {
  Colors,
  Icons,
  type UI,
  type KeyValuePair,
  type TableData,
  type CodeOptions,
  type StyledSpinner,
} from './ui-types.js';
import { getRuntimeContext } from './runtime-context.js';

/** Write a diagnostic line to stderr. */
function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** True when decorative output should be suppressed (agent/CI/json/quiet mode). */
function shouldSuppressDecoration(): boolean {
  const ctx = getRuntimeContext();
  return ctx.quiet || ctx.format === 'json';
}

/** Returns a chainable no-op spinner for quiet/json modes. */
function createNoopSpinner(initialText: string): StyledSpinner {
  const spinner = {
    text: initialText,
    prefixText: '',
    suffixText: '',
    color: 'blue',
    indent: 0,
    spinner: { interval: 80, frames: [''] },
    interval: 80,
    isSpinning: false,
    isEnabled: false,
    isSilent: true,
  } as unknown as StyledSpinner;

  const chain = (): StyledSpinner => spinner;
  spinner.start = chain;
  spinner.stop = chain;
  spinner.succeed = chain;
  spinner.fail = chain;
  spinner.warn = chain;
  spinner.info = chain;
  spinner.stopAndPersist = chain;
  spinner.clear = chain;
  spinner.render = chain;
  spinner.frame = (): string => '';

  return spinner;
}

/**
 * Neo CLI UI System
 *
 * A unified, modern console output utility that provides consistent,
 * beautiful terminal interfaces throughout Neo CLI.
 *
 * @example
 * ```typescript
 * import { ui } from '@/utils/ui.js';
 *
 * ui.success('Operation completed!');
 * ui.warn('Be careful!');
 * ui.info('Here is some information');
 * ```
 */
class UISystem implements UI {
  /** Color palette constants */
  public readonly colors = Colors;

  /** Icon constants */
  public readonly icons = Icons;

  // ============================================================================
  // Core Output Methods
  // ============================================================================

  public success(message: string): void {
    if (shouldSuppressDecoration()) return;
    err(chalk.hex(Colors.success)(`${Icons.success} ${message}`));
  }

  public error(message: string): void {
    // Errors always go to stderr even in json mode so users can see raw text
    // alongside the structured error object on stdout.
    err(chalk.hex(Colors.error)(`${Icons.error} ${message}`));
  }

  public warn(message: string): void {
    if (shouldSuppressDecoration()) return;
    err(chalk.hex(Colors.error)(`${Icons.warning} ${message}`));
  }

  public info(message: string): void {
    if (shouldSuppressDecoration()) return;
    err(chalk.hex(Colors.muted)(`${Icons.info} ${message}`));
  }

  public step(message: string): void {
    if (shouldSuppressDecoration()) return;
    err(chalk.hex(Colors.muted)(`${Icons.step} ${message}`));
  }

  public muted(message: string): void {
    if (shouldSuppressDecoration()) return;
    err(chalk.hex(Colors.muted)(message));
  }

  public highlight(message: string): void {
    if (shouldSuppressDecoration()) return;
    err(chalk.hex(Colors.primary)(`${Icons.highlight} ${message}`));
  }

  public link(text: string, url?: string): void {
    if (shouldSuppressDecoration()) return;
    if (url) {
      err(`${text}: ${chalk.hex(Colors.primary).underline(url)}`);
    } else {
      err(chalk.hex(Colors.primary).underline(text));
    }
  }

  public log(message: string): void {
    // log() is the one channel that intentionally writes to stdout — used by
    // commands to emit their actual payload.
    process.stdout.write(`${message}\n`);
  }

  public newline(): void {
    if (shouldSuppressDecoration()) return;
    err('');
  }

  public plain(message: string): void {
    if (shouldSuppressDecoration()) return;
    err(message);
  }

  // ============================================================================
  // Structured Output Methods
  // ============================================================================

  public section(title: string): void {
    if (shouldSuppressDecoration()) return;
    err(chalk.bold.hex(Colors.primary)(title));
    err(chalk.hex(Colors.muted)('─'.repeat(title.length)));
  }

  public list(items: string[]): void {
    if (shouldSuppressDecoration()) return;
    items.forEach((item) => {
      err(`  ${chalk.hex(Colors.muted)(Icons.bullet)} ${item}`);
    });
  }

  public keyValue(pairs: KeyValuePair[]): void {
    if (shouldSuppressDecoration()) return;
    if (pairs.length === 0) {
      return;
    }

    const maxKeyLength = Math.max(...pairs.map(([key]) => key.length));

    pairs.forEach(([key, value]) => {
      const paddedKey = key.padEnd(maxKeyLength);
      err(
        `  ${chalk.hex(Colors.muted)(paddedKey + ':')}  ${chalk.hex(Colors.primary)(value)}`
      );
    });
  }

  /**
   * Display data in a table format
   */
  public table(data: TableData): void {
    if (shouldSuppressDecoration()) return;
    const { headers, rows } = data;

    if (rows.length === 0) {
      return;
    }

    // Calculate column widths
    const columnWidths: number[] = [];
    const numColumns = rows[0]?.length || 0;

    for (let i = 0; i < numColumns; i++) {
      let maxWidth = headers?.[i]?.length || 0;
      for (const row of rows) {
        const cellWidth = row[i]?.length || 0;
        if (cellWidth > maxWidth) {
          maxWidth = cellWidth;
        }
      }
      columnWidths.push(maxWidth);
    }

    // Helper to create a row separator
    const createSeparator = (left: string, mid: string, right: string): string => {
      const parts = columnWidths.map((width) => '─'.repeat(width + 2));
      return left + parts.join(mid) + right;
    };

    // Helper to create a data row
    const createRow = (cells: string[]): string => {
      const paddedCells = cells.map((cell, i) => {
        const width = columnWidths[i] || 0;
        return ` ${cell.padEnd(width)} `;
      });
      return '│' + paddedCells.join('│') + '│';
    };

    err(chalk.hex(Colors.muted)(createSeparator('┌', '┬', '┐')));

    if (headers && headers.length > 0) {
      err(chalk.bold(createRow(headers)));
      err(chalk.hex(Colors.muted)(createSeparator('├', '┼', '┤')));
    }

    rows.forEach((row) => {
      err(createRow(row));
    });

    err(chalk.hex(Colors.muted)(createSeparator('└', '┴', '┘')));
  }

  public code(code: string, options?: CodeOptions): void {
    if (shouldSuppressDecoration()) return;
    const lines = code.split('\n');
    const { lineNumbers = false, startLine = 1 } = options || {};

    lines.forEach((line, index) => {
      if (lineNumbers) {
        const lineNum = (startLine + index).toString().padStart(3);
        err(`${chalk.hex(Colors.muted)(lineNum + ' │')} ${chalk.dim(line)}`);
      } else {
        err(chalk.dim(line));
      }
    });
  }

  public divider(): void {
    if (shouldSuppressDecoration()) return;
    const width = process.stdout.columns || 80;
    err(chalk.hex(Colors.muted)('─'.repeat(width)));
  }

  // ============================================================================
  // Spinner Integration
  // ============================================================================

  /**
   * Create a styled spinner with consistent appearance
   */
  public spinner(text: string): StyledSpinner {
    if (shouldSuppressDecoration()) {
      return createNoopSpinner(text);
    }
    const instance = ora({
      text,
      color: 'blue',
      stream: process.stderr,
    }) as StyledSpinner;

    // Override with styled versions
    instance.succeed = (text?: string): StyledSpinner => {
      const options: { symbol: string; text?: string } = {
        symbol: chalk.hex(Colors.success)(Icons.success),
      };
      if (text) {
        options.text = chalk.hex(Colors.success)(text);
      }
      instance.stopAndPersist(options);
      return instance;
    };

    instance.fail = (text?: string): StyledSpinner => {
      const options: { symbol: string; text?: string } = {
        symbol: chalk.hex(Colors.error)(Icons.error),
      };
      if (text) {
        options.text = chalk.hex(Colors.error)(text);
      }
      instance.stopAndPersist(options);
      return instance;
    };

    instance.warn = (text?: string): StyledSpinner => {
      const options: { symbol: string; text?: string } = {
        symbol: chalk.hex(Colors.error)(Icons.warning),
      };
      if (text) {
        options.text = chalk.hex(Colors.error)(text);
      }
      instance.stopAndPersist(options);
      return instance;
    };

    instance.info = (text?: string): StyledSpinner => {
      const options: { symbol: string; text?: string } = {
        symbol: chalk.hex(Colors.muted)(Icons.info),
      };
      if (text) {
        options.text = chalk.hex(Colors.muted)(text);
      }
      instance.stopAndPersist(options);
      return instance;
    };

    return instance;
  }
}

/**
 * Singleton instance of the UI system
 *
 * @example
 * ```typescript
 * import { ui } from '@/utils/ui.js';
 *
 * ui.success('Done!');
 * ui.error('Failed!');
 * ui.warn('Be careful!');
 * ```
 */
export const ui = new UISystem();

/**
 * Export types for external use
 */
export type { UI, KeyValuePair, TableData, CodeOptions, StyledSpinner } from './ui-types.js';
export { Colors, Icons } from './ui-types.js';
