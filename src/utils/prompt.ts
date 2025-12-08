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
