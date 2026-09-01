import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createUiMock, mockProcessExit } from '../../utils/test-helpers.js';

const readFileMock = vi.hoisted(() => vi.fn<(path: string, encoding: string) => Promise<string>>());

const shellMock = vi.hoisted(() => ({
  addAlias: vi.fn<(alias: string, command: string) => Promise<void>>(),
  backup: vi.fn<() => Promise<string | null>>(),
  getRcFile: vi.fn<() => string>(),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, readFile: readFileMock };
});

vi.mock('@/utils/shell.js', () => ({
  ZshIntegration: vi.fn(function ZshIntegration() {
    return shellMock;
  }),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

vi.mock('@/utils/ui.js', () => ({ ui: createUiMock() }));

import { confirm } from '@inquirer/prompts';
import { ui } from '@/utils/ui.js';
import { createSetupCommand, findConflictingAliases } from '@/commands/alias/setup/index.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';

const ALIASES = {
  gp: 'neo git pull',
  gpu: 'neo git push',
  gst: 'neo git stash',
};

const RC_FILE = '/home/user/.zshrc';
const BACKUP_FILE = '/home/user/.zshrc.neo-backup.2026-08-31T00-00-00-000Z';

describe('findConflictingAliases', () => {
  it('reports an alias whose current value differs from the target', () => {
    expect(findConflictingAliases('alias gp="git pull"\n', ALIASES)).toEqual([
      { alias: 'gp', current: 'git pull' },
    ]);
  });

  it('ignores an alias already set to the target value', () => {
    expect(findConflictingAliases(`alias gpu='neo git push'\n`, ALIASES)).toEqual([]);
  });

  it('ignores alias names that are not managed by neo', () => {
    expect(findConflictingAliases('alias ls="eza"\nalias g="git"\n', ALIASES)).toEqual([]);
  });

  it('parses both quote styles but not a mismatched pair', () => {
    const content = ['alias gp="git pull"', `alias gst='git stash'`, `alias gpu="git push'`].join(
      '\n'
    );

    expect(findConflictingAliases(content, ALIASES)).toEqual([
      { alias: 'gp', current: 'git pull' },
      { alias: 'gst', current: 'git stash' },
    ]);
  });

  it('skips indented and commented-out alias lines', () => {
    const content = ['# alias gp="git pull"', '  alias gpu="git push"'].join('\n');

    expect(findConflictingAliases(content, ALIASES)).toEqual([]);
  });

  it('trims the reported value and compares on the trimmed value', () => {
    const content = ['alias gp="  git pull  "   ', 'alias gpu="neo git push "'].join('\n');

    expect(findConflictingAliases(content, ALIASES)).toEqual([
      { alias: 'gp', current: 'git pull' },
    ]);
  });

  it('collects every conflict across the file in order', () => {
    const content = [
      'alias gp="git pull"',
      'export PATH=/usr/local/bin:$PATH',
      '',
      `alias gst='git stash'`,
    ].join('\n');

    expect(findConflictingAliases(content, ALIASES)).toEqual([
      { alias: 'gp', current: 'git pull' },
      { alias: 'gst', current: 'git stash' },
    ]);
  });

  it('does not report an alias bound to an empty value', () => {
    expect(findConflictingAliases('alias gp=""\n', ALIASES)).toEqual([]);
  });

  it('returns no conflicts for content with no alias lines', () => {
    expect(findConflictingAliases('', ALIASES)).toEqual([]);
  });
});

describe('createSetupCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    setRuntimeContext(buildRuntimeContext({ nonInteractive: false, yes: false }));
    shellMock.getRcFile.mockReturnValue(RC_FILE);
    shellMock.backup.mockResolvedValue(BACKUP_FILE);
    shellMock.addAlias.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue('');
  });

  afterEach(() => {
    exitMock.mockRestore();
    stdoutWriteSpy.mockRestore();
    setRuntimeContext(buildRuntimeContext());
  });

  it('exposes only the --force option', () => {
    const command = createSetupCommand();

    expect(command.name()).toBe('setup');
    expect(command.options.map(({ flags }) => flags)).toEqual(['-f, --force']);
  });

  it('backs up the rc file and writes every alias when there is no conflict', async () => {
    await createSetupCommand().parseAsync([], { from: 'user' });

    expect(readFileMock).toHaveBeenCalledWith(RC_FILE, 'utf-8');
    expect(shellMock.backup).toHaveBeenCalledTimes(1);
    expect(shellMock.addAlias.mock.calls).toEqual([
      ['gp', 'neo git pull'],
      ['gpu', 'neo git push'],
      ['gst', 'neo git stash'],
    ]);
    expect(ui.info).toHaveBeenCalledWith(`Backed up ${RC_FILE} to ${BACKUP_FILE}`);
    expect(ui.success).toHaveBeenCalledWith('Aliases configured successfully');
    expect(ui.list).toHaveBeenCalledWith([
      'gp="neo git pull"',
      'gpu="neo git push"',
      'gst="neo git stash"',
    ]);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('treats an unreadable rc file as empty content and still writes the aliases', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    await createSetupCommand().parseAsync([], { from: 'user' });

    expect(confirm).not.toHaveBeenCalled();
    expect(shellMock.addAlias).toHaveBeenCalledTimes(3);
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('warns instead of reporting a backup when no rc file exists', async () => {
    shellMock.backup.mockResolvedValue(null);

    await createSetupCommand().parseAsync([], { from: 'user' });

    expect(ui.warn).toHaveBeenCalledWith(
      'No existing ~/.zshrc found to back up, proceeding to create/update it'
    );
    expect(ui.info).not.toHaveBeenCalledWith(expect.stringContaining('Backed up'));
    expect(shellMock.addAlias).toHaveBeenCalledTimes(3);
  });

  it('emits the alias.setup envelope in json mode', async () => {
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createSetupCommand().parseAsync([], { from: 'user' });

    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0][0]))).toEqual({
      ok: true,
      command: 'alias.setup',
      aliases: { gp: 'neo git pull', gpu: 'neo git push', gst: 'neo git stash' },
      rcFile: RC_FILE,
    });
  });

  describe('with conflicting aliases in the rc file', () => {
    beforeEach(() => {
      readFileMock.mockResolvedValue(`alias gp="git pull"\nalias gst='git stash'\n`);
    });

    it('lists each conflict and aborts when the confirmation is declined', async () => {
      vi.mocked(confirm).mockResolvedValue(false);

      await createSetupCommand().parseAsync([], { from: 'user' });

      expect(ui.warn).toHaveBeenCalledWith(
        'The following aliases already exist and will be overwritten:'
      );
      expect(ui.plain).toHaveBeenNthCalledWith(1, '  gp: currently git pull -> new neo git pull');
      expect(ui.plain).toHaveBeenNthCalledWith(
        2,
        '  gst: currently git stash -> new neo git stash'
      );
      expect(confirm).toHaveBeenCalledWith({
        message: 'Proceed with overwriting these aliases?',
        default: false,
      });
      expect(ui.info).toHaveBeenCalledWith('Aborted. No changes were made');
      expect(shellMock.backup).not.toHaveBeenCalled();
      expect(shellMock.addAlias).not.toHaveBeenCalled();
    });

    it('overwrites when the confirmation is accepted', async () => {
      vi.mocked(confirm).mockResolvedValue(true);

      await createSetupCommand().parseAsync([], { from: 'user' });

      expect(shellMock.backup).toHaveBeenCalledTimes(1);
      expect(shellMock.addAlias).toHaveBeenCalledTimes(3);
      expect(ui.info).not.toHaveBeenCalledWith('Aborted. No changes were made');
    });

    it('skips the conflict prompt entirely with --force', async () => {
      await createSetupCommand().parseAsync(['--force'], { from: 'user' });

      expect(confirm).not.toHaveBeenCalled();
      expect(ui.warn).not.toHaveBeenCalledWith(
        'The following aliases already exist and will be overwritten:'
      );
      expect(shellMock.addAlias).toHaveBeenCalledTimes(3);
    });

    it('reports the conflicts but does not prompt when --yes is active', async () => {
      setRuntimeContext(buildRuntimeContext({ yes: true }));

      await createSetupCommand().parseAsync([], { from: 'user' });

      expect(ui.warn).toHaveBeenCalledWith(
        'The following aliases already exist and will be overwritten:'
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(shellMock.addAlias).toHaveBeenCalledTimes(3);
    });

    it('exits 2 without writing when non-interactive and --yes is absent', async () => {
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

      await createSetupCommand().parseAsync([], { from: 'user' });

      expect(confirm).not.toHaveBeenCalled();
      expect(ui.error).toHaveBeenCalledWith(
        'Interactive prompt required in non-interactive mode: "Existing aliases would be overwritten". Pass --force or --yes to bypass.'
      );
      expect(exitMock).toHaveBeenNthCalledWith(1, 2);
      expect(shellMock.backup).not.toHaveBeenCalled();
      expect(shellMock.addAlias).not.toHaveBeenCalled();
    });

    it('emits a NEO_NON_INTERACTIVE error payload in json mode', async () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));

      await createSetupCommand().parseAsync([], { from: 'user' });

      expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0][0]))).toEqual({
        error: {
          code: 'NEO_NON_INTERACTIVE',
          message:
            'Interactive prompt required in non-interactive mode: "Existing aliases would be overwritten". Pass --force or --yes to bypass.',
          flag: '--force or --yes',
          prompt: 'Existing aliases would be overwritten',
        },
      });
      expect(exitMock).toHaveBeenNthCalledWith(1, 2);
      expect(shellMock.addAlias).not.toHaveBeenCalled();
    });
  });
});
