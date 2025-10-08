import type { Ora } from 'ora';

/**
 * Color palette for the Neo CLI UI system
 *
 * All colors are carefully chosen to work well on both light and dark terminals
 * and are drawn from the Neo CLI brand gradient
 */
export const Colors = {
  /** Primary blue - used for info, links, and highlights */
  blue: '#0066FF',
  /** Purple - used for steps and progress indicators */
  purple: '#997FFF',
  /** Pink/Magenta - used for special highlights and accents */
  pink: '#F33FFF',
  /** Success green - used for successful operations */
  success: '#00CC66',
  /** Error red - used for errors and failures */
  error: '#FF3366',
  /** Warning amber - used for warnings and cautions */
  warning: '#FFAA33',
  /** Muted gray - used for secondary text and hints */
  muted: '#6B7280',
} as const;

/**
 * Type representing the available color keys
 */
export type ColorKey = keyof typeof Colors;

/**
 * Icon symbols used throughout the UI system
 *
 * All icons use widely-supported Unicode characters for maximum compatibility
 */
export const Icons = {
  /** Success checkmark (U+2713) */
  success: '✓',
  /** Error/failure cross (U+2716) */
  error: '✖',
  /** Warning sign (U+26A0) */
  warning: '⚠',
  /** Information symbol (U+2139) */
  info: 'ℹ',
  /** Step/progress arrow (U+2192) */
  step: '→',
  /** List bullet point (U+2022) */
  bullet: '•',
  /** Highlight diamond (U+25C6) */
  highlight: '◆',
  /** Collapsed/expandable indicator (U+25B8) */
  collapsed: '▸',
  /** Active/selected indicator (U+25C9) */
  active: '◉',
} as const;

/**
 * Type representing the available icon keys
 */
export type IconKey = keyof typeof Icons;

/**
 * Configuration options for table rendering
 */
export interface TableOptions {
  /** Column headers */
  headers?: string[];
  /** Table alignment for columns */
  align?: Array<'left' | 'center' | 'right'>;
  /** Whether to show borders */
  borders?: boolean;
}

/**
 * Data structure for table rendering
 */
export interface TableData {
  /** Column headers (optional) */
  headers?: string[];
  /** Rows of data */
  rows: string[][];
  /** Table rendering options */
  options?: TableOptions;
}

/**
 * Key-value pair for structured output
 */
export type KeyValuePair = [key: string, value: string];

/**
 * Configuration options for code block rendering
 */
export interface CodeOptions {
  /** Programming language for syntax highlighting */
  language?: string;
  /** Whether to show line numbers */
  lineNumbers?: boolean;
  /** Starting line number (if lineNumbers is true) */
  startLine?: number;
}

/**
 * Enhanced Ora spinner instance with styled methods
 */
export interface StyledSpinner extends Ora {
  /** Override succeed with consistent styling */
  succeed(text?: string): this;
  /** Override fail with consistent styling */
  fail(text?: string): this;
  /** Override warn with consistent styling */
  warn(text?: string): this;
  /** Override info with consistent styling */
  info(text?: string): this;
}

/**
 * Core UI output methods interface
 */
export interface UIOutput {
  /**
   * Display a success message with checkmark icon
   *
   * @param message - The success message to display
   *
   * @example
   * ```typescript
   * ui.success('Successfully pushed to remote!');
   * // Output: ✓ Successfully pushed to remote!
   * ```
   */
  success(message: string): void;

  /**
   * Display an error message with error icon
   *
   * @param message - The error message to display
   *
   * @example
   * ```typescript
   * ui.error('Failed to push to remote');
   * // Output: ✖ Failed to push to remote
   * ```
   */
  error(message: string): void;

  /**
   * Display a warning message with warning icon
   *
   * @param message - The warning message to display
   *
   * @example
   * ```typescript
   * ui.warn('You are about to push directly to main branch');
   * // Output: ⚠ You are about to push directly to main branch
   * ```
   */
  warn(message: string): void;

  /**
   * Display an informational message with info icon
   *
   * @param message - The info message to display
   *
   * @example
   * ```typescript
   * ui.info('Set upstream branch: feature/auth');
   * // Output: ℹ Set upstream branch: feature/auth
   * ```
   */
  info(message: string): void;

  /**
   * Display a step or progress message with arrow icon
   *
   * @param message - The step message to display
   *
   * @example
   * ```typescript
   * ui.step('Proceeding with push to main branch');
   * // Output: → Proceeding with push to main branch
   * ```
   */
  step(message: string): void;

  /**
   * Display muted/secondary text without icon
   *
   * @param message - The muted message to display
   *
   * @example
   * ```typescript
   * ui.muted('This is generally not recommended');
   * // Output: This is generally not recommended (in gray)
   * ```
   */
  muted(message: string): void;

  /**
   * Display a highlighted message with diamond icon
   *
   * @param message - The message to highlight
   *
   * @example
   * ```typescript
   * ui.highlight('Important: Back up your data first');
   * // Output: ◆ Important: Back up your data first
   * ```
   */
  highlight(message: string): void;

  /**
   * Display a link or URL with optional text
   *
   * @param text - The link text or URL
   * @param url - Optional URL if text is different
   *
   * @example
   * ```typescript
   * ui.link('Learn more', 'https://example.com');
   * // Output: Learn more: https://example.com (underlined blue)
   * ```
   */
  link(text: string, url?: string): void;

  /**
   * Display plain text without styling
   *
   * @param message - The message to display
   *
   * @example
   * ```typescript
   * ui.log('Some plain text');
   * // Output: Some plain text
   * ```
   */
  log(message: string): void;
}

/**
 * Structured output methods interface
 */
export interface UIStructured {
  /**
   * Display a section header with divider line
   *
   * @param title - The section title
   *
   * @example
   * ```typescript
   * ui.section('Configuration');
   * // Output:
   * // Configuration
   * // ─────────────
   * ```
   */
  section(title: string): void;

  /**
   * Display a bulleted list of items
   *
   * @param items - Array of items to display
   *
   * @example
   * ```typescript
   * ui.list(['First item', 'Second item', 'Third item']);
   * // Output:
   * //   • First item
   * //   • Second item
   * //   • Third item
   * ```
   */
  list(items: string[]): void;

  /**
   * Display key-value pairs with aligned formatting
   *
   * @param pairs - Array of key-value tuples
   *
   * @example
   * ```typescript
   * ui.keyValue([
   *   ['user.name', 'John Doe'],
   *   ['user.email', 'john@example.com']
   * ]);
   * // Output:
   * //   user.name:     John Doe
   * //   user.email:    john@example.com
   * ```
   */
  keyValue(pairs: KeyValuePair[]): void;

  /**
   * Display data in a table format
   *
   * @param data - Table data including headers and rows
   *
   * @example
   * ```typescript
   * ui.table({
   *   headers: ['Package', 'Version'],
   *   rows: [['typescript', '5.9.3'], ['chalk', '5.3.0']]
   * });
   * ```
   */
  table(data: TableData): void;

  /**
   * Display a code block with optional syntax highlighting
   *
   * @param code - The code to display
   * @param options - Code rendering options
   *
   * @example
   * ```typescript
   * ui.code('const x = 42;', { language: 'typescript' });
   * ```
   */
  code(code: string, options?: CodeOptions): void;

  /**
   * Display a horizontal divider line
   *
   * @example
   * ```typescript
   * ui.divider();
   * // Output: ────────────────────────────────────────
   * ```
   */
  divider(): void;
}

/**
 * Spinner methods interface
 */
export interface UISpinner {
  /**
   * Create a styled spinner with consistent appearance
   *
   * @param text - Initial spinner text
   * @returns A styled Ora spinner instance
   *
   * @example
   * ```typescript
   * const spinner = ui.spinner('Loading...');
   * spinner.start();
   * // ... do work ...
   * spinner.succeed('Done!');
   * ```
   */
  spinner(text: string): StyledSpinner;
}

/**
 * Complete UI interface combining all UI capabilities
 */
export interface UI extends UIOutput, UIStructured, UISpinner {
  /** Access to color constants */
  readonly colors: typeof Colors;
  /** Access to icon constants */
  readonly icons: typeof Icons;
}
