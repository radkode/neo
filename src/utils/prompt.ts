import select from '@inquirer/select';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export interface SelectChoice<T extends string> {
  label: string;
  value: T;
}

export interface SelectPromptOptions<T extends string> {
  choices: SelectChoice<T>[];
  defaultValue?: T;
  message: string;
}

/**
 * Present a selectable list with a numeric fallback for terminals where
 * interactive rendering is unavailable.
 */
export async function promptSelect<T extends string>({
  choices,
  defaultValue,
  message,
}: SelectPromptOptions<T>): Promise<T> {
  const defaultIndex =
    defaultValue !== undefined ? choices.findIndex(({ value }) => value === defaultValue) : 0;
  const safeDefaultIndex = defaultIndex >= 0 ? defaultIndex : 0;
  const fallbackValue = choices[safeDefaultIndex]?.value;

  if (!fallbackValue) {
    throw new Error('No choices provided to promptSelect');
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
}

/**
 * Prompt for a password/secret with masked input
 * Uses raw mode to hide typed characters
 */
export async function promptPassword({ message }: PasswordPromptOptions): Promise<string> {
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

      // Enter key
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

      // Ctrl+C
      if (charCode === 3) {
        if (input.isTTY) {
          input.setRawMode(false);
        }
        input.pause();
        input.removeListener('data', onData);
        output.write('\n');
        process.exit(1);
      }

      // Backspace
      if (charCode === 127 || charCode === 8) {
        if (password.length > 0) {
          password = password.slice(0, -1);
          output.write('\b \b');
        }
        return;
      }

      // Regular character
      password += char;
      output.write('*');
    };

    input.on('data', onData);
  });
}
