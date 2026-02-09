import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';
import {
  walkCommandTree,
  generateZshCompletions,
  generateBashCompletions,
  generateFishCompletions,
  CompletionGenerator,
} from '../../src/utils/completions.js';
import type { CommandNode } from '../../src/utils/completions.js';

// Mock dependencies
vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { writeFile, mkdir } from 'fs/promises';
import { logger } from '@/utils/logger.js';

function buildTestProgram(): Command {
  const program = new Command();
  program
    .name('neo')
    .description('Neo CLI')
    .version('1.0.0')
    .option('-v, --verbose', 'enable verbose logging')
    .option('-c, --config <path>', 'path to config file')
    .option('--no-color', 'disable colored output')
    .option('--no-banner', 'hide banner');

  const init = new Command('init');
  init.description('Install and configure Neo CLI globally');
  init.option('--force', 'force reconfiguration');
  init.option('--skip-install', 'skip global installation');
  program.addCommand(init);

  const config = new Command('config');
  config.description('Manage configuration');

  const configGet = new Command('get');
  configGet.description('Get a configuration value');
  configGet.argument('<key>', 'configuration key');
  config.addCommand(configGet);

  const configSet = new Command('set');
  configSet.description('Set a configuration value');
  configSet.argument('<key>', 'configuration key');
  configSet.argument('[value]', 'configuration value');
  config.addCommand(configSet);

  const configList = new Command('list');
  configList.description('List all configuration values');
  config.addCommand(configList);

  program.addCommand(config);

  const git = new Command('git');
  git.description('Git operations and utilities');

  const gitCommit = new Command('commit');
  gitCommit.description('Create a conventional commit');
  gitCommit.option('-t, --type <type>', 'commit type');
  gitCommit.option('-s, --scope <scope>', 'commit scope');
  gitCommit.option('-m, --message <message>', 'commit message');
  gitCommit.option('--breaking', 'mark as breaking change');
  gitCommit.option('-a, --all', 'stage all modified files');
  gitCommit.option('--ai', 'generate commit message using AI');
  git.addCommand(gitCommit);

  const gitPush = new Command('push');
  gitPush.description('Push commits to remote repository');
  gitPush.argument('[args...]', 'git push arguments');
  gitPush.option('--dry-run', 'show what would be pushed');
  gitPush.allowUnknownOption();
  git.addCommand(gitPush);

  const gitPull = new Command('pull');
  gitPull.description('Pull changes from remote repository');
  gitPull.option('--rebase', 'force rebase strategy');
  gitPull.option('--no-rebase', 'prevent automatic rebase');
  git.addCommand(gitPull);

  const gitBranch = new Command('branch');
  gitBranch.description('Analyze and manage local git branches');
  gitBranch.option('--dry-run', 'show what would be deleted');
  gitBranch.option('--force', 'force delete branches');
  git.addCommand(gitBranch);

  const gitStash = new Command('stash');
  gitStash.description('Interactively manage git stashes');
  git.addCommand(gitStash);

  const gitWorktree = new Command('worktree');
  gitWorktree.description('Manage git worktrees');
  const wtList = new Command('list');
  wtList.description('List all worktrees');
  gitWorktree.addCommand(wtList);
  const wtAdd = new Command('add');
  wtAdd.description('Create a worktree for a branch');
  wtAdd.argument('<branch>', 'branch name');
  wtAdd.option('-b, --branch <name>', 'create a new branch');
  gitWorktree.addCommand(wtAdd);
  git.addCommand(gitWorktree);

  program.addCommand(git);

  const gh = new Command('gh');
  gh.description('GitHub CLI operations');
  program.addCommand(gh);

  const pr = new Command('pr');
  pr.description('Create a pull request');
  pr.option('-t, --title <title>', 'PR title');
  program.addCommand(pr);

  const alias = new Command('alias');
  alias.description('Manage shell aliases');
  program.addCommand(alias);

  const update = new Command('update');
  update.description('Update Neo CLI to the latest version');
  update.option('--check-only', 'only check for updates');
  update.option('--force', 'force update');
  program.addCommand(update);

  const agent = new Command('agent');
  agent.description('Manage AI agent context');
  program.addCommand(agent);

  const completions = new Command('completions');
  completions.description('Generate or install shell completions');
  completions.argument('[shell]', 'shell type');
  program.addCommand(completions);

  return program;
}

describe('walkCommandTree', () => {
  let program: Command;
  let root: CommandNode;

  beforeEach(() => {
    program = buildTestProgram();
    root = walkCommandTree(program);
  });

  it('should extract the root command name', () => {
    expect(root.name).toBe('neo');
  });

  it('should extract global options', () => {
    const optNames = root.options.map((o) => o.long);
    expect(optNames).toContain('verbose');
    expect(optNames).toContain('config');
  });

  it('should extract all top-level commands', () => {
    const names = root.subcommands.map((s) => s.name);
    expect(names).toContain('init');
    expect(names).toContain('config');
    expect(names).toContain('git');
    expect(names).toContain('gh');
    expect(names).toContain('pr');
    expect(names).toContain('alias');
    expect(names).toContain('update');
    expect(names).toContain('agent');
    expect(names).toContain('completions');
  });

  it('should extract all git subcommands', () => {
    const git = root.subcommands.find((s) => s.name === 'git')!;
    const names = git.subcommands.map((s) => s.name);
    expect(names).toContain('commit');
    expect(names).toContain('push');
    expect(names).toContain('pull');
    expect(names).toContain('branch');
    expect(names).toContain('stash');
    expect(names).toContain('worktree');
  });

  it('should extract config subcommands', () => {
    const config = root.subcommands.find((s) => s.name === 'config')!;
    const names = config.subcommands.map((s) => s.name);
    expect(names).toContain('get');
    expect(names).toContain('set');
    expect(names).toContain('list');
  });

  it('should extract nested worktree subcommands', () => {
    const git = root.subcommands.find((s) => s.name === 'git')!;
    const worktree = git.subcommands.find((s) => s.name === 'worktree')!;
    const names = worktree.subcommands.map((s) => s.name);
    expect(names).toContain('list');
    expect(names).toContain('add');
  });

  it('should extract command options', () => {
    const git = root.subcommands.find((s) => s.name === 'git')!;
    const commit = git.subcommands.find((s) => s.name === 'commit')!;
    const optNames = commit.options.map((o) => o.long);
    expect(optNames).toContain('type');
    expect(optNames).toContain('scope');
    expect(optNames).toContain('message');
    expect(optNames).toContain('breaking');
    expect(optNames).toContain('all');
    expect(optNames).toContain('ai');
  });

  it('should extract option short flags', () => {
    const git = root.subcommands.find((s) => s.name === 'git')!;
    const commit = git.subcommands.find((s) => s.name === 'commit')!;
    const typeOpt = commit.options.find((o) => o.long === 'type')!;
    expect(typeOpt.short).toBe('t');
  });

  it('should extract command arguments', () => {
    const config = root.subcommands.find((s) => s.name === 'config')!;
    const get = config.subcommands.find((s) => s.name === 'get')!;
    expect(get.arguments).toHaveLength(1);
    expect(get.arguments[0]!.name).toBe('key');
    expect(get.arguments[0]!.required).toBe(true);
  });

  it('should detect variadic arguments', () => {
    const git = root.subcommands.find((s) => s.name === 'git')!;
    const push = git.subcommands.find((s) => s.name === 'push')!;
    expect(push.arguments[0]!.variadic).toBe(true);
  });

  it('should detect allowUnknownOption', () => {
    const git = root.subcommands.find((s) => s.name === 'git')!;
    const push = git.subcommands.find((s) => s.name === 'push')!;
    expect(push.allowUnknownOption).toBe(true);
  });

  it('should skip help subcommands', () => {
    const names = root.subcommands.map((s) => s.name);
    expect(names).not.toContain('help');
  });

  it('should identify boolean options', () => {
    const verboseOpt = root.options.find((o) => o.long === 'verbose')!;
    expect(verboseOpt.isBoolean).toBe(true);

    const configOpt = root.options.find((o) => o.long === 'config')!;
    expect(configOpt.isBoolean).toBe(false);
  });
});

describe('generateZshCompletions', () => {
  let root: CommandNode;

  beforeEach(() => {
    root = walkCommandTree(buildTestProgram());
  });

  it('should include compdef header', () => {
    const output = generateZshCompletions(root);
    expect(output).toContain('#compdef neo n');
  });

  it('should include dynamic helpers', () => {
    const output = generateZshCompletions(root);
    expect(output).toContain('_neo_git_branches()');
    expect(output).toContain('_neo_git_remotes()');
    expect(output).toContain("git branch --list --format='%(refname:short)'");
    expect(output).toContain('git remote');
  });

  it('should include main _neo function', () => {
    const output = generateZshCompletions(root);
    expect(output).toContain('_neo()');
    expect(output).toContain('_neo "$@"');
  });

  it('should include all top-level commands as completions', () => {
    const output = generateZshCompletions(root);
    expect(output).toContain("'init:");
    expect(output).toContain("'config:");
    expect(output).toContain("'git:");
    expect(output).toContain("'gh:");
    expect(output).toContain("'pr:");
    expect(output).toContain("'alias:");
    expect(output).toContain("'update:");
    expect(output).toContain("'agent:");
    expect(output).toContain("'completions:");
  });

  it('should include git subcommand functions', () => {
    const output = generateZshCompletions(root);
    expect(output).toContain('_neo_git()');
    expect(output).toContain("'commit:");
    expect(output).toContain("'push:");
    expect(output).toContain("'pull:");
    expect(output).toContain("'branch:");
    expect(output).toContain("'stash:");
    expect(output).toContain("'worktree:");
  });

  it('should include global options', () => {
    const output = generateZshCompletions(root);
    expect(output).toContain('--verbose');
    expect(output).toContain('--config');
  });

  it('should include commit options', () => {
    const output = generateZshCompletions(root);
    expect(output).toContain('--type');
    expect(output).toContain('--scope');
    expect(output).toContain('--message');
    expect(output).toContain('--breaking');
  });

  it('should include alias completion for n', () => {
    const output = generateZshCompletions(root);
    expect(output).toContain('compdef _neo n');
  });

  it('should generate recursive subcommand functions for worktree', () => {
    const output = generateZshCompletions(root);
    expect(output).toContain('_neo_git_worktree()');
  });
});

describe('generateBashCompletions', () => {
  let root: CommandNode;

  beforeEach(() => {
    root = walkCommandTree(buildTestProgram());
  });

  it('should include bash shebang', () => {
    const output = generateBashCompletions(root);
    expect(output).toContain('#!/bin/bash');
  });

  it('should include _neo_completions function', () => {
    const output = generateBashCompletions(root);
    expect(output).toContain('_neo_completions()');
  });

  it('should register with complete -F for neo and n', () => {
    const output = generateBashCompletions(root);
    expect(output).toContain('complete -F _neo_completions neo');
    expect(output).toContain('complete -F _neo_completions n');
  });

  it('should include all top-level command names', () => {
    const output = generateBashCompletions(root);
    expect(output).toContain('init');
    expect(output).toContain('config');
    expect(output).toContain('git');
    expect(output).toContain('update');
    expect(output).toContain('agent');
  });

  it('should include git subcommands in case block', () => {
    const output = generateBashCompletions(root);
    expect(output).toContain('commit)');
    expect(output).toContain('push)');
    expect(output).toContain('pull)');
  });

  it('should include dynamic completions for commit type', () => {
    const output = generateBashCompletions(root);
    expect(output).toContain('feat fix docs style refactor test chore');
  });

  it('should include dynamic completion helpers', () => {
    const output = generateBashCompletions(root);
    expect(output).toContain('_neo_git_branches()');
    expect(output).toContain('_neo_git_remotes()');
  });
});

describe('generateFishCompletions', () => {
  let root: CommandNode;

  beforeEach(() => {
    root = walkCommandTree(buildTestProgram());
  });

  it('should include fish header comment', () => {
    const output = generateFishCompletions(root);
    expect(output).toContain('# Neo CLI completion script for Fish');
  });

  it('should clear existing completions', () => {
    const output = generateFishCompletions(root);
    expect(output).toContain('complete -c neo -e');
  });

  it('should include dynamic completion functions', () => {
    const output = generateFishCompletions(root);
    expect(output).toContain('function _neo_git_branches');
    expect(output).toContain('function _neo_git_remotes');
  });

  it('should include top-level subcommands with conditions', () => {
    const output = generateFishCompletions(root);
    expect(output).toContain('complete -c neo -n "__fish_use_subcommand" -f -a init');
    expect(output).toContain('complete -c neo -n "__fish_use_subcommand" -f -a git');
    expect(output).toContain('complete -c neo -n "__fish_use_subcommand" -f -a config');
  });

  it('should include global options', () => {
    const output = generateFishCompletions(root);
    expect(output).toContain('-l verbose');
    expect(output).toContain('-l config');
  });

  it('should include alias completion for n', () => {
    const output = generateFishCompletions(root);
    expect(output).toContain('complete -c n -w neo');
  });

  it('should include git subcommands with proper conditions', () => {
    const output = generateFishCompletions(root);
    expect(output).toContain('__fish_seen_subcommand_from git');
  });
});

describe('CompletionGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateCompletions', () => {
    it('should generate zsh completions from program', () => {
      const program = buildTestProgram();
      const output = CompletionGenerator.generateCompletions(program, 'zsh');
      expect(output).toContain('#compdef neo n');
      expect(output).toContain('_neo()');
    });

    it('should generate bash completions from program', () => {
      const program = buildTestProgram();
      const output = CompletionGenerator.generateCompletions(program, 'bash');
      expect(output).toContain('#!/bin/bash');
      expect(output).toContain('complete -F _neo_completions neo');
    });

    it('should generate fish completions from program', () => {
      const program = buildTestProgram();
      const output = CompletionGenerator.generateCompletions(program, 'fish');
      expect(output).toContain('complete -c neo -e');
      expect(output).toContain('complete -c n -w neo');
    });
  });

  describe('generateZshCompletions (legacy)', () => {
    it('should generate a fallback zsh completion script', () => {
      const result = CompletionGenerator.generateZshCompletions();
      expect(result).toContain('#compdef neo n');
      expect(result).toContain('_neo()');
    });

    it('should include all 9 top-level commands in fallback', () => {
      const result = CompletionGenerator.generateZshCompletions();
      expect(result).toContain("'init:");
      expect(result).toContain("'config:");
      expect(result).toContain("'git:");
      expect(result).toContain("'gh:");
      expect(result).toContain("'pr:");
      expect(result).toContain("'alias:");
      expect(result).toContain("'update:");
      expect(result).toContain("'agent:");
    });

    it('should include all git subcommands in fallback', () => {
      const result = CompletionGenerator.generateZshCompletions();
      expect(result).toContain("'commit:");
      expect(result).toContain("'push:");
      expect(result).toContain("'pull:");
      expect(result).toContain("'branch:");
      expect(result).toContain("'stash:");
      expect(result).toContain("'worktree:");
    });
  });

  describe('createCompletionFiles', () => {
    it('should create completions directory', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await CompletionGenerator.createCompletionFiles('/test/completions');

      expect(mkdir).toHaveBeenCalledWith('/test/completions', { recursive: true });
    });

    it('should write ZSH, Bash, Fish, and alias completion files', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await CompletionGenerator.createCompletionFiles('/test/completions');

      expect(writeFile).toHaveBeenCalledWith(
        '/test/completions/_neo',
        expect.stringContaining('#compdef neo n'),
        'utf-8'
      );
      expect(writeFile).toHaveBeenCalledWith(
        '/test/completions/neo.bash',
        expect.stringContaining('#!/bin/bash'),
        'utf-8'
      );
      expect(writeFile).toHaveBeenCalledWith(
        '/test/completions/neo.fish',
        expect.stringContaining('complete -c neo'),
        'utf-8'
      );
      expect(writeFile).toHaveBeenCalledWith(
        '/test/completions/_n',
        expect.stringContaining('compdef neo n'),
        'utf-8'
      );
    });

    it('should use program tree when program is provided', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const program = buildTestProgram();
      await CompletionGenerator.createCompletionFiles('/test/completions', program);

      // Should contain actual commands from the program
      const zshCall = vi.mocked(writeFile).mock.calls.find((c) => c[0] === '/test/completions/_neo');
      expect(zshCall).toBeDefined();
      const content = zshCall![1] as string;
      expect(content).toContain("'completions:");
    });

    it('should log debug messages on success', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await CompletionGenerator.createCompletionFiles('/test/completions');

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Created completion file')
      );
    });

    it('should throw on mkdir error', async () => {
      vi.mocked(mkdir).mockRejectedValue(new Error('Permission denied'));

      await expect(
        CompletionGenerator.createCompletionFiles('/test/completions')
      ).rejects.toThrow('Permission denied');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create completion files')
      );
    });

    it('should throw on writeFile error', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockRejectedValue(new Error('Write failed'));

      await expect(
        CompletionGenerator.createCompletionFiles('/test/completions')
      ).rejects.toThrow('Write failed');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create completion files')
      );
    });
  });

  describe('updateCompletions', () => {
    it('should call createCompletionFiles', async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await CompletionGenerator.updateCompletions('/test/completions');

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
    });
  });
});
