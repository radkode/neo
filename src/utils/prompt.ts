import select from '@inquirer/select';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getRuntimeContext } from './runtime-context.js';

export interface SelectChoice<T extends string> {
  label: string;
  value: T;
}

export interface SelectPromptOptions<T extends string> {
  choices: SelectChoice<T>[];
  defaultValue?: T;
  message: string;
  /**
   * Name of the equivalent CLI flag to surface in the non-interactive error.
   * Helps agents learn which flag to pass next time.
   */
  flag?: string;
  /**
   * If true, --non-interactive (without --yes) will accept the default rather
   * than throw. Set this only when the default is safe/non-destructive.
   */
  safeDefaultForNonInteractive?: boolean;
}

/**
 * Error thrown when a prompt is required but --non-interactive mode is active.
 * Commands should let this bubble up — it carries a non-zero exit expectation.
 */
export class NonInteractiveError extends Error {
  readonly code = 'NEO_NON_INTERACTIVE';
  readonly flag?: string;
  readonly prompt: string;

  constructor(prompt: string, flag?: string) {
    const suffix = flag ? ` Pass ${flag} to bypass.` : '';
    super(`Interactive prompt required in non-interactive mode: "${prompt}".${suffix}`);
    this.name = 'NonInteractiveError';
    this.prompt = prompt;
    if (flag !== undefined) {
      this.flag = flag;
    }
  }
}

/**
 * Present a selectable list with a numeric fallback for terminals where
 * interactive rendering is unavailable. In non-interactive mode, returns the
 * default value if one is set, or throws NonInteractiveError otherwise.
 */
export async function promptSelect<T extends string>({
  choices,
  defaultValue,
  message,
  flag,
  safeDefaultForNonInteractive,
}: SelectPromptOptions<T>): Promise<T> {
  const defaultIndex =
    defaultValue !== undefined ? choices.findIndex(({ value }) => value === defaultValue) : 0;
  const safeDefaultIndex = defaultIndex >= 0 ? defaultIndex : 0;
  const fallbackValue = choices[safeDefaultIndex]?.value;

  if (!fallbackValue) {
    throw new Error('No choices provided to promptSelect');
  }

  const ctx = getRuntimeContext();

  // --yes accepts the default without asking.
  if (ctx.yes && defaultValue !== undefined) {
    return fallbackValue;
  }

  // --non-interactive: only auto-accept defaults flagged as safe.
  if (ctx.nonInteractive) {
    if (safeDefaultForNonInteractive && defaultValue !== undefined) {
      return fallbackValue;
    }
    throw new NonInteractiveError(message, flag);
  }

  if (input.isTTY && output.isTTY) {
    const interactiveResult = await select({
      choices: choices.map(({ label, value }) => ({
        name: label,
        value,
      })),
      default: defaultValue ?? fallbackValue,
      loop: false,
      message,
      pageSize: Math.max(choices.length, 4),
    }).catch(() => undefined);

    if (interactiveResult !== undefined) {
      return interactiveResult;
    }
  }

  const rl = readline.createInterface({ input, output });

  try {
    console.log(message);
    choices.forEach(({ label }, index) => {
      const marker = index === safeDefaultIndex ? ' (default)' : '';
      console.log(`  ${index + 1}. ${label}${marker}`);
    });

    let selected: T | null = null;

    while (selected === null) {
      const answer = await rl.question(`Select an option [${safeDefaultIndex + 1}]: `);
      if (!answer.trim()) {
        return fallbackValue;
      }

      const parsedIndex = Number.parseInt(answer.trim(), 10) - 1;

      if (parsedIndex >= 0 && parsedIndex < choices.length) {
        selected = choices[parsedIndex]?.value ?? fallbackValue;
        break;
      }

      console.log('Please enter a valid number from the list.');
    }

    return selected ?? fallbackValue;
  } finally {
    rl.close();
  }
}

export interface PasswordPromptOptions {
  message: string;
  /** Env var name the user can set instead of being prompted. */
  envVar?: string;
}

/**
 * Prompt for a password/secret with masked input.
 * In non-interactive mode, reads from the env var if provided, otherwise throws.
 */
export async function promptPassword({
  message,
  envVar,
}: PasswordPromptOptions): Promise<string> {
  const ctx = getRuntimeContext();

  if (envVar && process.env[envVar]) {
    return process.env[envVar] as string;
  }

  if (ctx.nonInteractive) {
    throw new NonInteractiveError(
      message,
      envVar ? `$${envVar} env var` : undefined
    );
  }

  return new Promise((resolve) => {
    let password = '';

    output.write(`${message}: `);

    if (input.isTTY) {
      input.setRawMode(true);
    }
    input.resume();
    input.setEncoding('utf8');

    const onData = (char: string) => {
      const charCode = char.charCodeAt(0);

      if (charCode === 13 || charCode === 10) {
        if (input.isTTY) {
          input.setRawMode(false);
        }
        input.pause();
        input.removeListener('data', onData);
        output.write('\n');
        resolve(password);
        return;
      }

      if (charCode === 3) {
        if (input.isTTY) {
          input.setRawMode(false);
        }
        input.pause();
        input.removeListener('data', onData);
        output.write('\n');
        process.exit(1);
      }

      if (charCode === 127 || charCode === 8) {
        if (password.length > 0) {
          password = password.slice(0, -1);
          output.write('\b \b');
        }
        return;
      }

      password += char;
      output.write('*');
    };

    input.on('data', onData);
  });
}

/**
 * Shared guard used by commands that call inquirer directly. Returns true when
 * a prompt may proceed; otherwise throws NonInteractiveError or returns false
 * if the caller should substitute a default.
 *
 * Usage:
 *   if (!mayPrompt('commit confirmation', '--yes')) {
 *     // fall back to default behavior
 *   }
 */
export function mayPrompt(promptDescription: string, flag?: string): boolean {
  const ctx = getRuntimeContext();
  if (ctx.yes) return false; // caller should accept default
  if (ctx.nonInteractive) {
    throw new NonInteractiveError(promptDescription, flag);
  }
  return true;
}

/**
 * Variant of mayPrompt that, rather than throwing, returns a sentinel result
 * describing the outcome. Useful when the caller has a sensible default.
 */
export interface PromptGate {
  shouldPrompt: boolean;
  acceptDefault: boolean;
}

export function promptGate(): PromptGate {
  const ctx = getRuntimeContext();
  if (ctx.yes) return { shouldPrompt: false, acceptDefault: true };
  if (ctx.nonInteractive) return { shouldPrompt: false, acceptDefault: true };
  return { shouldPrompt: true, acceptDefault: false };
}
