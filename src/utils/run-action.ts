/**
 * Centralized action wrapper for Commander command handlers.
 *
 * Every `.action(...)` in the CLI used to reimplement the same error tail:
 *   try { ... } catch (err) {
 *     if (err instanceof NonInteractiveError) { emitError(err); process.exit(2); }
 *     emitError(err); process.exit(1);
 *   }
 * Some files drifted — forgot the NonInteractiveError branch, or swallowed
 * it inside a nested try/catch and exited 1 where spec says 2. runAction
 * is the single place that guarantees:
 *   - NonInteractiveError -> exit code 2 + structured JSON error
 *   - any other Error      -> exit code 1 + structured JSON error
 *
 * Command handlers should simply:
 *   .action(runAction(async (arg, opts) => { ... }))
 * and let thrown errors propagate.
 */

import { NonInteractiveError } from './prompt.js';
import { emitError } from './output.js';

export type CommandActionFn<Args extends unknown[]> = (...args: Args) => Promise<void> | void;

export function runAction<Args extends unknown[]>(
  fn: CommandActionFn<Args>
): (...args: Args) => Promise<void> {
  return async (...args: Args): Promise<void> => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof NonInteractiveError) {
        emitError(error);
        process.exit(2);
      }
      const err = error instanceof Error ? error : new Error(String(error));
      emitError(err);
      process.exit(1);
    }
  };
}
