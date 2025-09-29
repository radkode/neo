import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '@/utils/logger.js';

export class CompletionGenerator {
  /**
   * Generates a basic ZSH completion script for neo CLI
   */
  static generateZshCompletions(): string {
    return `#compdef neo n

# Neo CLI completion script
# This file provides command completion for neo CLI in ZSH

_neo_commands() {
  local -a commands
  commands=(
    'init:Install and configure Neo CLI globally'
    'config:Manage configuration'
    'git:Git operations and utilities'
    'help:Display help for command'
  )
  _describe 'neo commands' commands
}

_neo_config_subcommands() {
  local -a subcommands
  subcommands=(
    'get:Get a configuration value'
    'set:Set a configuration value'
    'list:List all configuration values'
  )
  _describe 'config subcommands' subcommands
}

_neo_git_subcommands() {
  local -a subcommands
  subcommands=(
    'push:Push commits to remote repository'
  )
  _describe 'git subcommands' subcommands
}

_neo() {
  local context state line
  
  _arguments -C \\
    '1: :_neo_commands' \\
    '*::arg:->args' \\
    '--verbose[Enable verbose logging]' \\
    '--config=[Path to config file]:file:_files' \\
    '--no-color[Disable colored output]' \\
    '--no-banner[Hide banner]' \\
    '--help[Show help]' \\
    '--version[Show version]'
  
  case $state in
    args)
      case $words[1] in
        config)
          _arguments -C \\
            '1: :_neo_config_subcommands' \\
            '*::arg:->config_args'
          ;;
        git)
          _arguments -C \\
            '1: :_neo_git_subcommands' \\
            '*::arg:->git_args'
          ;;
        init)
          _arguments \\
            '--force[Force reconfiguration if already initialized]' \\
            '--skip-install[Skip global installation]' \\
            '--help[Show help]'
          ;;
      esac
      ;;
  esac
}

# Main completion function
_neo "$@"

# Also provide completion for 'n' alias
compdef _neo n
`;
  }

  /**
   * Creates the completions directory and writes the completion script
   */
  static async createCompletionFiles(completionsPath: string): Promise<void> {
    try {
      // Ensure completions directory exists
      await mkdir(completionsPath, { recursive: true });

      // Write the main completion file
      const completionFile = join(completionsPath, '_neo');
      const completionContent = this.generateZshCompletions();

      await writeFile(completionFile, completionContent, 'utf-8');
      logger.debug(`Created completion file: ${completionFile}`);

      // Also create a completion for the 'n' alias
      const aliasCompletionFile = join(completionsPath, '_n');
      const aliasContent = `#compdef n
# Completion for 'n' alias (points to neo)
compdef neo n
`;

      await writeFile(aliasCompletionFile, aliasContent, 'utf-8');
      logger.debug(`Created alias completion file: ${aliasCompletionFile}`);
    } catch (error) {
      logger.error(`Failed to create completion files: ${error}`);
      throw error;
    }
  }

  /**
   * Updates completions based on current CLI commands
   * This is a placeholder for future dynamic completion generation
   */
  static async updateCompletions(completionsPath: string): Promise<void> {
    // For now, just regenerate the static completions
    await this.createCompletionFiles(completionsPath);
  }
}
