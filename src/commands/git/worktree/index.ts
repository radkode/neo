/**
 * Git worktree command
 * Manage git worktrees with an intuitive interface
 */

import { Command } from '@commander-js/extra-typings';
import { createWorktreeListCommand } from './list.js';
import { createWorktreeAddCommand } from './add.js';
import { createWorktreeRemoveCommand } from './remove.js';
import { createWorktreeSwitchCommand } from './switch.js';

/**
 * Create the git worktree command with all subcommands
 */
export function createWorktreeCommand(): Command {
  const command = new Command('worktree');

  command
    .description('Manage git worktrees')
    .addCommand(createWorktreeListCommand())
    .addCommand(createWorktreeAddCommand())
    .addCommand(createWorktreeRemoveCommand())
    .addCommand(createWorktreeSwitchCommand());

  return command;
}

// Re-export subcommands for testing
export { createWorktreeListCommand } from './list.js';
export { createWorktreeAddCommand } from './add.js';
export { createWorktreeRemoveCommand } from './remove.js';
export { createWorktreeSwitchCommand } from './switch.js';

// Re-export utilities for testing
export * from './utils.js';
