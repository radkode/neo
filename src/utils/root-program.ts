import type { Command } from '@commander-js/extra-typings';

/**
 * Walks up from a subcommand to the root program, so a command can inspect the full tree.
 */
export function getRootProgram(command: Command): Command {
  let current: Command = command;
  while (current.parent) {
    current = current.parent as Command;
  }
  return current;
}
