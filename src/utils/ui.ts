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

  /**
   * Display a success message with checkmark icon
   */
  public success(message: string): void {
    console.log(chalk.hex(Colors.success)(`${Icons.success} ${message}`));
  }

  /**
   * Display an error message with error icon
   */
  public error(message: string): void {
    console.error(chalk.hex(Colors.error)(`${Icons.error} ${message}`));
  }

  /**
   * Display a warning message with warning icon
   */
  public warn(message: string): void {
    console.log(chalk.hex(Colors.warning)(`${Icons.warning} ${message}`));
  }

  /**
   * Display an informational message with info icon
   */
  public info(message: string): void {
    console.log(chalk.hex(Colors.blue)(`${Icons.info} ${message}`));
  }

  /**
   * Display a step or progress message with arrow icon
   */
  public step(message: string): void {
    console.log(chalk.hex(Colors.purple)(`${Icons.step} ${message}`));
  }

  /**
   * Display muted/secondary text without icon
   */
  public muted(message: string): void {
    console.log(chalk.hex(Colors.muted)(message));
  }

  /**
   * Display a highlighted message with diamond icon
   */
  public highlight(message: string): void {
    console.log(chalk.hex(Colors.pink)(`${Icons.highlight} ${message}`));
  }

  /**
   * Display a link or URL with optional text
   */
  public link(text: string, url?: string): void {
    if (url) {
      console.log(`${text}: ${chalk.hex(Colors.blue).underline(url)}`);
    } else {
      console.log(chalk.hex(Colors.blue).underline(text));
    }
  }

  /**
   * Display plain text without styling
   */
  public log(message: string): void {
    console.log(message);
  }

  // ============================================================================
  // Structured Output Methods
  // ============================================================================

  /**
   * Display a section header with divider line
   */
  public section(title: string): void {
    console.log(chalk.bold(title));
    console.log(chalk.hex(Colors.muted)('─'.repeat(title.length)));
  }

  /**
   * Display a bulleted list of items
   */
  public list(items: string[]): void {
    items.forEach((item) => {
      console.log(`  ${chalk.hex(Colors.muted)(Icons.bullet)} ${item}`);
    });
  }

  /**
   * Display key-value pairs with aligned formatting
   */
  public keyValue(pairs: KeyValuePair[]): void {
    if (pairs.length === 0) {
      return;
    }

    // Calculate the maximum key length for alignment
    const maxKeyLength = Math.max(...pairs.map(([key]) => key.length));

    pairs.forEach(([key, value]) => {
      const paddedKey = key.padEnd(maxKeyLength);
      console.log(
        `  ${chalk.hex(Colors.muted)(paddedKey + ':')}  ${chalk.hex(Colors.blue)(value)}`
      );
    });
  }

  /**
   * Display data in a table format
   */
  public table(data: TableData): void {
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

    // Print table
    console.log(chalk.hex(Colors.muted)(createSeparator('┌', '┬', '┐')));

    // Print headers if provided
    if (headers && headers.length > 0) {
      console.log(chalk.bold(createRow(headers)));
      console.log(chalk.hex(Colors.muted)(createSeparator('├', '┼', '┤')));
    }

    // Print rows
    rows.forEach((row) => {
      console.log(createRow(row));
    });

    console.log(chalk.hex(Colors.muted)(createSeparator('└', '┴', '┘')));
  }

  /**
   * Display a code block with optional syntax highlighting
   */
  public code(code: string, options?: CodeOptions): void {
    const lines = code.split('\n');
    const { lineNumbers = false, startLine = 1 } = options || {};

    lines.forEach((line, index) => {
      if (lineNumbers) {
        const lineNum = (startLine + index).toString().padStart(3);
        console.log(`${chalk.hex(Colors.muted)(lineNum + ' │')} ${chalk.dim(line)}`);
      } else {
        console.log(chalk.dim(line));
      }
    });
  }

  /**
   * Display a horizontal divider line
   */
  public divider(): void {
    const width = process.stdout.columns || 80;
    console.log(chalk.hex(Colors.muted)('─'.repeat(width)));
  }

  // ============================================================================
  // Spinner Integration
  // ============================================================================

  /**
   * Create a styled spinner with consistent appearance
   */
  public spinner(text: string): StyledSpinner {
    const instance = ora({
      text,
      color: 'blue',
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
        symbol: chalk.hex(Colors.warning)(Icons.warning),
      };
      if (text) {
        options.text = chalk.hex(Colors.warning)(text);
      }
      instance.stopAndPersist(options);
      return instance;
    };

    instance.info = (text?: string): StyledSpinner => {
      const options: { symbol: string; text?: string } = {
        symbol: chalk.hex(Colors.blue)(Icons.info),
      };
      if (text) {
        options.text = chalk.hex(Colors.blue)(text);
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
