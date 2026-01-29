/**
 * Command registry for managing plugin commands
 */

import type { ICommand, ICommandRegistry, CommandMetadata } from '@/core/interfaces/index.js';

interface RegisteredCommand {
  command: ICommand;
  metadata: CommandMetadata | undefined;
}

/**
 * Registry for plugin commands
 */
export class CommandRegistry implements ICommandRegistry {
  private commands: Map<string, RegisteredCommand> = new Map();

  /**
   * Register a command with optional metadata
   */
  register(command: ICommand, metadata?: CommandMetadata): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command "${command.name}" is already registered`);
    }
    this.commands.set(command.name, { command, metadata });
  }

  /**
   * Unregister a command by name
   */
  unregister(commandName: string): void {
    this.commands.delete(commandName);
  }

  /**
   * Get a command by name
   */
  get(commandName: string): ICommand | undefined {
    return this.commands.get(commandName)?.command;
  }

  /**
   * Get all registered commands
   */
  getAll(): ICommand[] {
    return Array.from(this.commands.values()).map((r) => r.command);
  }

  /**
   * Get commands by group
   */
  getByGroup(group: string): ICommand[] {
    return Array.from(this.commands.values())
      .filter((r) => r.metadata?.group === group)
      .map((r) => r.command);
  }

  /**
   * Check if a command is registered
   */
  hasCommand(commandName: string): boolean {
    return this.commands.has(commandName);
  }

  /**
   * Get metadata for a command
   */
  getMetadata(commandName: string): CommandMetadata | undefined {
    return this.commands.get(commandName)?.metadata;
  }

  /**
   * Get all command names
   */
  getNames(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * Clear all registered commands
   */
  clear(): void {
    this.commands.clear();
  }

  /**
   * Get the number of registered commands
   */
  get size(): number {
    return this.commands.size;
  }
}

// Singleton instance
export const commandRegistry = new CommandRegistry();
