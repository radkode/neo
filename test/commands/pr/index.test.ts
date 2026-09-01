import { Command } from '@commander-js/extra-typings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrAliasCommand } from '@/commands/pr/index.js';
import { executeGhPrCreate } from '@/commands/gh/pr/create/index.js';
import { CommandError, failure, success } from '@/core/errors/index.js';
import { ui } from '@/utils/ui.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { mockProcessExit } from '../../utils/test-helpers.js';

vi.mock('@/commands/gh/pr/create/index.js', () => ({ executeGhPrCreate: vi.fn() }));

vi.mock('@/utils/ui.js', async () => {
  const { createUiMock } = await import('../../utils/test-helpers.js');
  return { ui: createUiMock() };
});

const prUrl = 'https://github.com/radkode/neo/pull/123';

function renderHelp(command: Command): string {
  let help = '';
  command.configureOutput({
    writeOut: (str) => {
      help += str;
    },
  });
  command.outputHelp();
  return help;
}

describe('createPrAliasCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    setRuntimeContext(buildRuntimeContext());
    vi.mocked(executeGhPrCreate).mockResolvedValue(success(prUrl));
  });

  afterEach(() => {
    exitMock.mockRestore();
    stdoutWriteSpy.mockRestore();
    setRuntimeContext(buildRuntimeContext());
  });

  describe('command definition', () => {
    it('is named pr and describes itself as an alias for gh pr create', () => {
      const command = createPrAliasCommand();

      expect(command.name()).toBe('pr');
      expect(command.description()).toBe('Create a pull request (alias for gh pr create)');
    });

    it('declares the same option flags as gh pr create', () => {
      const flags = createPrAliasCommand().options.map((option) => option.flags);

      expect(flags).toEqual([
        '-t, --title <title>',
        '-b, --body <body>',
        '-B, --base <branch>',
        '-d, --draft',
        '-r, --reviewer <reviewers...>',
        '-l, --label <labels...>',
        '-w, --web',
      ]);
    });

    it('prints examples written in the alias form, not the gh pr create form', () => {
      const help = renderHelp(createPrAliasCommand());

      expect(help).toContain('Examples:');
      expect(help).toContain('    $ neo pr\n');
      expect(help).toContain('$ neo pr --title "Add X" --body "..." --base main');
      expect(help).toContain('$ neo pr --yes --json');
      expect(help).not.toContain('neo gh pr create');
    });
  });

  describe('delegation to executeGhPrCreate', () => {
    it('forwards every parsed option, collecting variadic values into arrays', async () => {
      await createPrAliasCommand().parseAsync(
        [
          '--title',
          'Add X',
          '--body',
          'Why X',
          '--base',
          'main',
          '--draft',
          '--reviewer',
          'alice',
          'bob',
          '--label',
          'bug',
          '--web',
        ],
        { from: 'user' }
      );

      expect(executeGhPrCreate).toHaveBeenCalledWith({
        title: 'Add X',
        body: 'Why X',
        base: 'main',
        draft: true,
        reviewer: ['alice', 'bob'],
        label: ['bug'],
        web: true,
      });
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('forwards an empty option set for the bare interactive form', async () => {
      await createPrAliasCommand().parseAsync([], { from: 'user' });

      expect(executeGhPrCreate).toHaveBeenCalledWith({});
      expect(exitMock).not.toHaveBeenCalled();
    });

    it('lets the root program own --yes and --json so the documented form parses', async () => {
      const program = new Command()
        .option('--json', 'emit machine-readable JSON on stdout')
        .option('-y, --yes', 'auto-accept prompt defaults');
      program.addCommand(createPrAliasCommand());

      await program.parseAsync(['pr', '--yes', '--json'], { from: 'user' });

      expect(executeGhPrCreate).toHaveBeenCalledWith({});
      expect(program.opts()).toEqual({ json: true, yes: true });
      expect(exitMock).not.toHaveBeenCalled();
    });
  });

  describe('option validation', () => {
    it('rejects a base branch that fails the schema branch-name pattern', async () => {
      await createPrAliasCommand().parseAsync(['--base', 'bad branch!'], { from: 'user' });

      expect(executeGhPrCreate).not.toHaveBeenCalled();
      expect(ui.error).toHaveBeenCalledWith('Invalid pr options');
      expect(ui.warn).toHaveBeenCalledWith('✖ base: Invalid branch name format');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('rejects an empty title', async () => {
      await createPrAliasCommand().parseAsync(['--title', ''], { from: 'user' });

      expect(executeGhPrCreate).not.toHaveBeenCalled();
      expect(ui.warn).toHaveBeenCalledWith('✖ title: PR title cannot be empty');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('rejects an empty reviewer entry', async () => {
      await createPrAliasCommand().parseAsync(['--reviewer', 'alice', ''], { from: 'user' });

      expect(executeGhPrCreate).not.toHaveBeenCalled();
      expect(ui.warn).toHaveBeenCalledWith('✖ reviewer.1: Reviewer cannot be empty');
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('failure propagation', () => {
    it('re-throws the CommandError so runAction renders it and exits 1', async () => {
      vi.mocked(executeGhPrCreate).mockResolvedValue(
        failure(
          new CommandError('Failed to create PR: gh exited with 1', 'gh-pr-create', {
            suggestions: ['Check your GitHub CLI configuration: gh auth status'],
          })
        )
      );

      await createPrAliasCommand().parseAsync([], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Failed to create PR: gh exited with 1');
      expect(ui.list).toHaveBeenCalledWith(['Check your GitHub CLI configuration: gh auth status']);
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('emits the classified error as a JSON envelope under --json', async () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
      vi.mocked(executeGhPrCreate).mockResolvedValue(
        failure(
          new CommandError('A pull request already exists for this branch', 'gh-pr-create', {
            suggestions: ['View existing PR: gh pr view --web'],
          })
        )
      );

      await createPrAliasCommand().parseAsync([], { from: 'user' });

      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]));
      expect(payload).toEqual({
        error: {
          code: 'COMMAND_ERROR',
          message: 'A pull request already exists for this branch',
          category: 'COMMAND',
          severity: 'medium',
          suggestions: ['View existing PR: gh pr view --web'],
        },
      });
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });
});
