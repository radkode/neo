import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '@/utils/logger.js';
import type { Command } from '@commander-js/extra-typings';

// === Intermediate Representation ===

export interface OptionNode {
  flags: string;
  long: string;
  short?: string;
  description: string;
  required: boolean;
  isBoolean: boolean;
  isVariadic: boolean;
  argName?: string;
  choices?: string[];
}

export interface ArgumentNode {
  name: string;
  description: string;
  required: boolean;
  variadic: boolean;
  choices?: string[];
}

export interface CommandNode {
  name: string;
  description: string;
  options: OptionNode[];
  arguments: ArgumentNode[];
  subcommands: CommandNode[];
  allowUnknownOption: boolean;
}

// === Dynamic Completion Contexts ===

export interface DynamicCompletion {
  /** Shell function name (e.g. _neo_git_branches) */
  functionName: string;
  /** Shell command to generate completions */
  shellCommand: string;
  /** Description for the completion context */
  description: string;
}

const DYNAMIC_COMPLETIONS = {
  branches: {
    functionName: '_neo_git_branches',
    shellCommand: "git branch --list --format='%(refname:short)' 2>/dev/null",
    description: 'Git branch names',
  },
  remotes: {
    functionName: '_neo_git_remotes',
    shellCommand: 'git remote 2>/dev/null',
    description: 'Git remote names',
  },
} as const satisfies Record<string, DynamicCompletion>;

const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'];

const CONFIG_KEYS = [
  'preferences.banner',
  'preferences.theme',
  'preferences.aliases.n',
  'ai.enabled',
  'ai.model',
  'shell.type',
  'shell.rcFile',
  'updates.lastCheckedAt',
  'updates.latestVersion',
  'plugins.enabled',
];

// === Tree Walker ===

export function walkCommandTree(command: Command): CommandNode {
  const options: OptionNode[] = [];

  for (const opt of command.options) {
    const flags = opt.flags;
    const long = opt.long ?? '';
    const short = opt.short;
    const isBoolean = !opt.required && !opt.optional;

    const shortStr = short?.replace(/^-/, '');
    const argChoices = (opt as unknown as { argChoices?: string[] }).argChoices;

    const optNode: OptionNode = {
      flags,
      long: long.replace(/^--/, ''),
      description: opt.description ?? '',
      required: opt.required ?? false,
      isBoolean,
      isVariadic: opt.variadic ?? false,
    };
    if (shortStr) optNode.short = shortStr;
    const argNameStr = opt.long?.replace(/^--/, '');
    if (!isBoolean && argNameStr) optNode.argName = argNameStr;
    if (argChoices) optNode.choices = argChoices;

    options.push(optNode);
  }

  const args: ArgumentNode[] = [];
  for (const arg of (command as unknown as { registeredArguments: Array<{ _name: string; description: string; required: boolean; variadic: boolean; argChoices?: string[] }> }).registeredArguments ?? []) {
    const argNode: ArgumentNode = {
      name: arg._name,
      description: arg.description ?? '',
      required: arg.required,
      variadic: arg.variadic ?? false,
    };
    if (arg.argChoices) argNode.choices = arg.argChoices;
    args.push(argNode);
  }

  const subcommands: CommandNode[] = [];
  for (const sub of command.commands) {
    // Skip internal help command
    if (sub.name() === 'help') continue;
    subcommands.push(walkCommandTree(sub as Command));
  }

  return {
    name: command.name(),
    description: command.description() ?? '',
    options,
    arguments: args,
    subcommands,
    allowUnknownOption: (command as unknown as { _allowUnknownOption: boolean })._allowUnknownOption ?? false,
  };
}

// === ZSH Generator ===

export function generateZshCompletions(root: CommandNode): string {
  const lines: string[] = [];

  lines.push('#compdef neo n');
  lines.push('');
  lines.push('# Neo CLI completion script (auto-generated)');
  lines.push('# Do not edit manually - regenerate with: neo completions zsh');
  lines.push('');

  // Dynamic helper functions
  lines.push('# Dynamic completion helpers');
  for (const [, dc] of Object.entries(DYNAMIC_COMPLETIONS)) {
    lines.push(`${dc.functionName}() {`);
    lines.push(`  local -a items`);
    lines.push(`  items=(\${(f)"$(${dc.shellCommand})"})`);
    lines.push(`  compadd -a items`);
    lines.push('}');
    lines.push('');
  }

  // Generate functions for each command with subcommands
  generateZshCommandFunction(root, lines, []);

  lines.push('');
  lines.push('# Main completion function');
  lines.push('_neo "$@"');
  lines.push('');
  lines.push("# Also provide completion for 'n' alias");
  lines.push('compdef _neo n');
  lines.push('');

  return lines.join('\n');
}

function zshFunctionName(path: string[]): string {
  if (path.length === 0) return '_neo';
  return '_neo_' + path.join('_');
}

function generateZshCommandFunction(node: CommandNode, lines: string[], path: string[]): void {
  const funcName = zshFunctionName(path);

  // First, recursively generate functions for subcommands that have their own subcommands
  for (const sub of node.subcommands) {
    generateZshCommandFunction(sub, lines, [...path, sub.name]);
  }

  lines.push(`${funcName}() {`);

  if (node.subcommands.length > 0) {
    lines.push('  local context state line');
    lines.push('');

    // Build _arguments call
    const argParts: string[] = [];
    argParts.push("'1: :->cmds'");
    argParts.push("'*::arg:->args'");

    // Add options
    for (const opt of node.options) {
      argParts.push(`'${formatZshOption(opt)}'`);
    }

    lines.push(`  _arguments -C \\`);
    for (let i = 0; i < argParts.length; i++) {
      const sep = i < argParts.length - 1 ? ' \\' : '';
      lines.push(`    ${argParts[i]}${sep}`);
    }
    lines.push('');

    lines.push('  case $state in');
    lines.push('    cmds)');
    lines.push('      local -a commands');
    lines.push('      commands=(');
    for (const sub of node.subcommands) {
      const desc = sub.description.replace(/'/g, "'\\''");
      lines.push(`        '${sub.name}:${desc}'`);
    }
    lines.push('      )');
    lines.push("      _describe 'commands' commands");
    lines.push('      ;;');
    lines.push('    args)');
    lines.push('      case $words[1] in');
    for (const sub of node.subcommands) {
      const subFuncName = zshFunctionName([...path, sub.name]);
      lines.push(`        ${sub.name})`);
      lines.push(`          ${subFuncName}`);
      lines.push('          ;;');
    }
    lines.push('      esac');
    lines.push('      ;;');
    lines.push('  esac');
  } else {
    // Leaf command - just list options and arguments
    const argParts: string[] = [];

    // Add options
    for (const opt of node.options) {
      argParts.push(`'${formatZshOption(opt)}'`);
    }

    // Add arguments
    for (let i = 0; i < node.arguments.length; i++) {
      const arg = node.arguments[i]!;
      const argSpec = formatZshArgument(arg, i + 1, node);
      if (argSpec) argParts.push(`'${argSpec}'`);
    }

    if (argParts.length > 0) {
      lines.push('  _arguments \\');
      for (let i = 0; i < argParts.length; i++) {
        const sep = i < argParts.length - 1 ? ' \\' : '';
        lines.push(`    ${argParts[i]}${sep}`);
      }
    }
  }

  lines.push('}');
  lines.push('');
}

function formatZshOption(opt: OptionNode): string {
  const desc = opt.description.replace(/'/g, "'\\''").replace(/\[/g, '\\[').replace(/\]/g, '\\]');
  const longFlag = `--${opt.long}`;

  if (opt.isBoolean) {
    return `${longFlag}[${desc}]`;
  }

  if (opt.choices) {
    const choiceStr = opt.choices.join(' ');
    return `${longFlag}=[${desc}]:${opt.long}:(${choiceStr})`;
  }

  return `${longFlag}=[${desc}]:${opt.long}:`;
}

function formatZshArgument(arg: ArgumentNode, position: number, parentNode: CommandNode): string | null {
  const desc = arg.description.replace(/'/g, "'\\''");

  // Check for dynamic completions based on context
  if (arg.name === 'branch' || arg.name === 'name') {
    if (isGitContext(parentNode)) {
      return `${position}: :${DYNAMIC_COMPLETIONS.branches.functionName}`;
    }
  }

  if (arg.name === 'type' || (arg.name === 'key' && parentNode.name === 'set')) {
    if (arg.choices) {
      return `${position}:${desc}:(${arg.choices.join(' ')})`;
    }
  }

  // Config keys
  if (arg.name === 'key' && (parentNode.name === 'get' || parentNode.name === 'set')) {
    return `${position}:${desc}:(${CONFIG_KEYS.join(' ')})`;
  }

  if (arg.variadic) {
    return `*:${desc}:`;
  }

  return `${position}:${desc}:`;
}

function isGitContext(node: CommandNode): boolean {
  // Check if any parent context relates to git
  return node.name === 'add' || node.name === 'remove' || node.name === 'switch' || node.name === 'branch';
}

// === Bash Generator ===

export function generateBashCompletions(root: CommandNode): string {
  const lines: string[] = [];

  lines.push('#!/bin/bash');
  lines.push('');
  lines.push('# Neo CLI completion script for Bash (auto-generated)');
  lines.push('# Do not edit manually - regenerate with: neo completions bash');
  lines.push('');

  // Dynamic helpers
  lines.push('# Dynamic completion helpers');
  for (const [, dc] of Object.entries(DYNAMIC_COMPLETIONS)) {
    lines.push(`${dc.functionName}() {`);
    lines.push(`  ${dc.shellCommand}`);
    lines.push('}');
    lines.push('');
  }

  // Main completion function
  lines.push('_neo_completions() {');
  lines.push('  local cur prev words cword');
  lines.push('  _init_completion || return');
  lines.push('');

  generateBashCaseBlock(root, lines, 1);

  lines.push('}');
  lines.push('');
  lines.push('complete -F _neo_completions neo');
  lines.push('complete -F _neo_completions n');
  lines.push('');

  return lines.join('\n');
}

function generateBashCaseBlock(node: CommandNode, lines: string[], depth: number): void {
  const indent = '  '.repeat(depth);

  if (node.subcommands.length === 0) {
    // Leaf command - complete options
    const opts = node.options.map((o) => `--${o.long}`).join(' ');
    lines.push(`${indent}COMPREPLY=($(compgen -W "${opts}" -- "$cur"))`);
    return;
  }

  // Determine which word position to check based on depth
  const subcmdNames = node.subcommands.map((s) => s.name).join(' ');
  const opts = node.options.map((o) => `--${o.long}`).join(' ');
  const allWords = [subcmdNames, opts].filter(Boolean).join(' ');

  if (depth === 1) {
    // Top-level: check number of words to decide
    lines.push(`${indent}case "\${words[1]}" in`);
    for (const sub of node.subcommands) {
      lines.push(`${indent}  ${sub.name})`);
      if (sub.subcommands.length > 0) {
        generateBashSubcommandCase(sub, lines, depth + 2);
      } else {
        const subOpts = sub.options.map((o) => `--${o.long}`).join(' ');
        lines.push(`${indent}    COMPREPLY=($(compgen -W "${subOpts}" -- "$cur"))`);
      }
      lines.push(`${indent}    return`);
      lines.push(`${indent}    ;;`);
    }
    lines.push(`${indent}esac`);
    lines.push('');
    lines.push(`${indent}if [[ $cword -eq 1 ]]; then`);
    lines.push(`${indent}  COMPREPLY=($(compgen -W "${allWords}" -- "$cur"))`);
    lines.push(`${indent}fi`);
  }
}

function generateBashSubcommandCase(node: CommandNode, lines: string[], depth: number): void {
  const indent = '  '.repeat(depth);
  const subcmdNames = node.subcommands.map((s) => s.name).join(' ');
  const opts = node.options.map((o) => `--${o.long}`).join(' ');
  const allWords = [subcmdNames, opts].filter(Boolean).join(' ');

  lines.push(`${indent}case "\${words[2]}" in`);
  for (const sub of node.subcommands) {
    lines.push(`${indent}  ${sub.name})`);
    if (sub.subcommands.length > 0) {
      // Deeper nesting
      const deepSubNames = sub.subcommands.map((s) => s.name).join(' ');
      const deepOpts = sub.options.map((o) => `--${o.long}`).join(' ');
      lines.push(`${indent}    COMPREPLY=($(compgen -W "${deepSubNames} ${deepOpts}" -- "$cur"))`);
    } else {
      const subOpts = sub.options.map((o) => `--${o.long}`).join(' ');
      // Handle dynamic completions for specific contexts
      if (node.name === 'git' && sub.name === 'commit') {
        lines.push(`${indent}    if [[ "$prev" == "--type" || "$prev" == "-t" ]]; then`);
        lines.push(`${indent}      COMPREPLY=($(compgen -W "${COMMIT_TYPES.join(' ')}" -- "$cur"))`);
        lines.push(`${indent}    else`);
        lines.push(`${indent}      COMPREPLY=($(compgen -W "${subOpts}" -- "$cur"))`);
        lines.push(`${indent}    fi`);
      } else {
        lines.push(`${indent}    COMPREPLY=($(compgen -W "${subOpts}" -- "$cur"))`);
      }
    }
    lines.push(`${indent}    return`);
    lines.push(`${indent}    ;;`);
  }
  lines.push(`${indent}esac`);
  lines.push(`${indent}if [[ $cword -eq 2 ]]; then`);
  lines.push(`${indent}  COMPREPLY=($(compgen -W "${allWords}" -- "$cur"))`);
  lines.push(`${indent}fi`);
}

// === Fish Generator ===

export function generateFishCompletions(root: CommandNode): string {
  const lines: string[] = [];

  lines.push('# Neo CLI completion script for Fish (auto-generated)');
  lines.push('# Do not edit manually - regenerate with: neo completions fish');
  lines.push('');

  // Helper functions for dynamic completions
  for (const [, dc] of Object.entries(DYNAMIC_COMPLETIONS)) {
    lines.push(`function ${dc.functionName}`);
    lines.push(`  ${dc.shellCommand}`);
    lines.push('end');
    lines.push('');
  }

  // Clear any existing completions
  lines.push('# Clear existing completions');
  lines.push('complete -c neo -e');
  lines.push('');

  // Generate completions recursively
  generateFishCommandCompletions(root, lines, []);

  // Alias
  lines.push('');
  lines.push("# Alias 'n' completions");
  lines.push('complete -c n -w neo');
  lines.push('');

  return lines.join('\n');
}

function generateFishCommandCompletions(node: CommandNode, lines: string[], path: string[]): void {
  const isRoot = path.length === 0;

  // Generate condition for this command level
  const condition = fishCondition(path);

  if (isRoot) {
    // Add global options
    for (const opt of node.options) {
      const parts = ['complete -c neo'];
      parts.push('-n "__fish_use_subcommand"');
      if (opt.short) parts.push(`-s ${opt.short}`);
      parts.push(`-l ${opt.long}`);
      parts.push(`-d '${opt.description.replace(/'/g, "\\'")}'`);
      lines.push(parts.join(' '));
    }
    lines.push('');
  }

  // Add subcommands
  for (const sub of node.subcommands) {
    const parts = ['complete -c neo'];
    parts.push(`-n "${condition}"`);
    parts.push(`-f -a ${sub.name}`);
    parts.push(`-d '${sub.description.replace(/'/g, "\\'")}'`);
    lines.push(parts.join(' '));
  }

  if (node.subcommands.length > 0) {
    lines.push('');
  }

  // Recurse into subcommands
  for (const sub of node.subcommands) {
    const subPath = [...path, sub.name];

    // Add options for this subcommand
    for (const opt of sub.options) {
      const subCondition = fishSubcommandCondition(subPath);
      const parts = ['complete -c neo'];
      parts.push(`-n "${subCondition}"`);
      if (opt.short) parts.push(`-s ${opt.short}`);
      parts.push(`-l ${opt.long}`);
      parts.push(`-d '${opt.description.replace(/'/g, "\\'")}'`);
      if (opt.choices) {
        parts.push(`-r -f -a '${opt.choices.join(' ')}'`);
      }
      lines.push(parts.join(' '));
    }

    // Recurse if this subcommand has its own subcommands
    if (sub.subcommands.length > 0) {
      generateFishCommandCompletions(sub, lines, subPath);
    }
  }
}

function fishCondition(path: string[]): string {
  if (path.length === 0) {
    return '__fish_use_subcommand';
  }
  return path.map((p) => `__fish_seen_subcommand_from ${p}`).join('; and ');
}

function fishSubcommandCondition(path: string[]): string {
  return path.map((p) => `__fish_seen_subcommand_from ${p}`).join('; and ');
}

// === Shell Type ===

export type ShellType = 'zsh' | 'bash' | 'fish';

// === Main API ===

export class CompletionGenerator {
  /**
   * Generates completion script for the given shell by walking the Commander.js program tree
   */
  static generateCompletions(program: Command, shell: ShellType): string {
    const root = walkCommandTree(program);

    switch (shell) {
      case 'zsh':
        return generateZshCompletions(root);
      case 'bash':
        return generateBashCompletions(root);
      case 'fish':
        return generateFishCompletions(root);
    }
  }

  /**
   * Generates a ZSH completion script (legacy, used when no program available)
   */
  static generateZshCompletions(): string {
    // Build a minimal command tree for backwards compatibility
    return generateZshCompletions(buildFallbackTree());
  }

  /**
   * Creates the completions directory and writes completion scripts
   */
  static async createCompletionFiles(completionsPath: string, program?: Command): Promise<void> {
    try {
      await mkdir(completionsPath, { recursive: true });

      const root = program ? walkCommandTree(program) : buildFallbackTree();

      // Write ZSH completion file
      const zshFile = join(completionsPath, '_neo');
      const zshContent = generateZshCompletions(root);
      await writeFile(zshFile, zshContent, 'utf-8');
      logger.debug(`Created completion file: ${zshFile}`);

      // Write Bash completion file
      const bashFile = join(completionsPath, 'neo.bash');
      const bashContent = generateBashCompletions(root);
      await writeFile(bashFile, bashContent, 'utf-8');
      logger.debug(`Created completion file: ${bashFile}`);

      // Write Fish completion file
      const fishFile = join(completionsPath, 'neo.fish');
      const fishContent = generateFishCompletions(root);
      await writeFile(fishFile, fishContent, 'utf-8');
      logger.debug(`Created completion file: ${fishFile}`);

      // Also create ZSH alias completion file
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
   */
  static async updateCompletions(completionsPath: string, program?: Command): Promise<void> {
    await this.createCompletionFiles(completionsPath, program);
  }
}

// === Fallback Tree (when no program is available) ===

function buildFallbackTree(): CommandNode {
  return {
    name: 'neo',
    description: 'Neo CLI',
    options: [
      { flags: '-v, --verbose', long: 'verbose', short: 'v', description: 'Enable verbose logging', required: false, isBoolean: true, isVariadic: false },
      { flags: '-c, --config <path>', long: 'config', short: 'c', description: 'Path to config file', required: false, isBoolean: false, isVariadic: false, argName: 'path' },
      { flags: '--no-color', long: 'color', description: 'Disable colored output', required: false, isBoolean: true, isVariadic: false },
      { flags: '--no-banner', long: 'banner', description: 'Hide banner', required: false, isBoolean: true, isVariadic: false },
    ],
    arguments: [],
    subcommands: [
      { name: 'init', description: 'Install and configure Neo CLI globally', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
      { name: 'config', description: 'Manage configuration', options: [], arguments: [], subcommands: [
        { name: 'get', description: 'Get a configuration value', options: [], arguments: [{ name: 'key', description: 'Configuration key', required: true, variadic: false }], subcommands: [], allowUnknownOption: false },
        { name: 'set', description: 'Set a configuration value', options: [], arguments: [{ name: 'key', description: 'Configuration key', required: true, variadic: false }], subcommands: [], allowUnknownOption: false },
        { name: 'list', description: 'List all configuration values', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
      ], allowUnknownOption: false },
      { name: 'git', description: 'Git operations and utilities', options: [], arguments: [], subcommands: [
        { name: 'commit', description: 'Create a conventional commit', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
        { name: 'push', description: 'Push commits to remote repository', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
        { name: 'pull', description: 'Pull changes from remote repository', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
        { name: 'branch', description: 'Analyze and manage local git branches', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
        { name: 'stash', description: 'Interactively manage git stashes', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
        { name: 'worktree', description: 'Manage git worktrees', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
      ], allowUnknownOption: false },
      { name: 'gh', description: 'GitHub CLI operations', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
      { name: 'pr', description: 'Create a pull request', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
      { name: 'alias', description: 'Manage shell aliases', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
      { name: 'update', description: 'Update Neo CLI to the latest version', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
      { name: 'agent', description: 'Manage AI agent context and configuration', options: [], arguments: [], subcommands: [], allowUnknownOption: false },
    ],
    allowUnknownOption: false,
  };
}
