import { execa } from 'execa';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createTempDir, execaResult, type TempDir } from '../../../utils/test-helpers.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promptSelect } from '@/utils/prompt.js';
import { confirm, input, editor } from '@inquirer/prompts';
import { ui } from '@/utils/ui.js';
import { GitError, GitErrorCode } from '@/utils/git-errors.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';

const spinnerMock = {
  start: vi.fn(),
  stop: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
  text: '',
};

vi.mock('execa', () => {
  const execa = vi.fn();
  return { execa };
});

vi.mock('@/utils/prompt.js', () => {
  const promptSelect = vi.fn();
  return { promptSelect };
});

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
  input: vi.fn(),
  editor: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    info: vi.fn(),
    list: vi.fn(),
    muted: vi.fn(),
    spinner: vi.fn(() => ({ ...spinnerMock })),
    step: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    newline: vi.fn(),
    plain: vi.fn(),
  },
}));

describe('gh pr create command', () => {
  const execaMock = vi.mocked(execa);
  const promptSelectMock = vi.mocked(promptSelect);
  const confirmMock = vi.mocked(confirm);
  const inputMock = vi.mocked(input);
  const editorMock = vi.mocked(editor);
  const warnMock = vi.mocked(ui.warn);
  const infoMock = vi.mocked(ui.info);
  let exitMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    setRuntimeContext(buildRuntimeContext());
    spinnerMock.start.mockClear();
    spinnerMock.stop.mockClear();
    spinnerMock.succeed.mockClear();
    spinnerMock.fail.mockClear();
    spinnerMock.text = '';
  });

  afterEach(() => {
    exitMock.mockRestore();
    setRuntimeContext(buildRuntimeContext());
    vi.resetAllMocks();
  });

  interface PrScenario {
    branch?: string;
    unpushed?: boolean;
    remoteBranch?: boolean;
    lastCommit?: string | Error;
    pushError?: Error;
    prUrl?: string;
  }

  function mockPrScenario(scenario: PrScenario = {}): void {
    const {
      branch = 'jacek/auto',
      unpushed = false,
      remoteBranch = true,
      lastCommit = 'feat: add the widget',
      pushError,
      prUrl = 'https://github.com/owner/repo/pull/200',
    } = scenario;

    execaMock.mockImplementation((async (cmd: string, args: readonly string[] = []) => {
      if (cmd === 'gh' && args[0] === '--version') {
        return execaResult({ stdout: 'gh version 2.0.0' });
      }
      if (cmd === 'gh' && args[0] === 'auth') {
        return execaResult({ stdout: 'Logged in' });
      }
      if (cmd === 'git' && args[0] === 'branch') {
        return execaResult({ stdout: branch });
      }
      if (cmd === 'git' && args[0] === 'remote') {
        return execaResult({ stdout: 'HEAD branch: main' });
      }
      if (cmd === 'git' && args[0] === 'log' && args[1] === '--oneline') {
        return execaResult({ stdout: unpushed ? 'abc123 Some commit' : '' });
      }
      if (cmd === 'git' && args[0] === 'ls-remote') {
        if (!remoteBranch) {
          throw new Error('no matching remote branch');
        }
        return execaResult({ stdout: `refs/heads/${branch}` });
      }
      if (cmd === 'git' && args[0] === 'push') {
        if (pushError) {
          throw pushError;
        }
        return execaResult({ stdout: 'pushed' });
      }
      if (cmd === 'git' && args[0] === 'log' && args[1] === '-1') {
        if (lastCommit instanceof Error) {
          throw lastCommit;
        }
        return execaResult({ stdout: lastCommit });
      }
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') {
        return execaResult({ stdout: prUrl });
      }
      return execaResult({ stdout: '' });
    }) as unknown as Parameters<typeof execaMock.mockImplementation>[0]);
  }

  function prCreateCall(): [string, readonly string[], unknown] | undefined {
    return execaMock.mock.calls.find(
      ([cmd, args]) =>
        cmd === 'gh' && Array.isArray(args) && args[0] === 'pr' && args[1] === 'create'
    ) as [string, readonly string[], unknown] | undefined;
  }

  function pushCall(): [string, readonly string[], unknown] | undefined {
    return execaMock.mock.calls.find(
      ([cmd, args]) => cmd === 'git' && Array.isArray(args) && args[0] === 'push'
    ) as [string, readonly string[], unknown] | undefined;
  }

  it('should fail if gh CLI is not installed', async () => {
    const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');

    execaMock.mockRejectedValueOnce(new Error('gh not found'));

    const result = await executeGhPrCreate({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('GitHub CLI (gh) is not installed');
    }
  });

  it('should fail if not authenticated with gh', async () => {
    const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');

    // gh --version succeeds
    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'gh version 2.0.0' }));
    // gh auth status fails
    execaMock.mockRejectedValueOnce(new Error('not logged in'));

    const result = await executeGhPrCreate({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Not authenticated');
    }
  });

  it('should fail if on default branch', async () => {
    const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');

    // gh --version succeeds
    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'gh version 2.0.0' }));
    // gh auth status succeeds
    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'Logged in' }));
    // git branch --show-current returns main
    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'main' }));
    // git remote show origin returns main as HEAD branch
    execaMock.mockResolvedValueOnce(execaResult({ stdout: 'HEAD branch: main' }));

    const result = await executeGhPrCreate({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Cannot create PR from main branch');
    }
  });

  it('should create PR successfully with all options provided', async () => {
    const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');

    execaMock.mockImplementation((async (cmd: string, args?: readonly string[]) => {
      if (cmd === 'gh' && args?.[0] === '--version') {
        return execaResult({ stdout: 'gh version 2.0.0' });
      }
      if (cmd === 'gh' && args?.[0] === 'auth') {
        return execaResult({ stdout: 'Logged in' });
      }
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '--show-current') {
        return execaResult({ stdout: 'feature/test-branch' });
      }
      if (cmd === 'git' && args?.[0] === 'remote' && args?.[1] === 'show') {
        return execaResult({ stdout: 'HEAD branch: main' });
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '--oneline') {
        return execaResult({ stdout: '' }); // No unpushed commits
      }
      if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'create') {
        return execaResult({ stdout: 'https://github.com/owner/repo/pull/123' });
      }
      return execaResult({ stdout: '' });
    }) as unknown as Parameters<typeof execaMock.mockImplementation>[0]);

    const result = await executeGhPrCreate({
      title: 'Test PR',
      body: 'Test body',
      base: 'main',
      draft: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('https://github.com/owner/repo/pull/123');
    }
  });

  it('should prompt for title when not provided', async () => {
    const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');

    execaMock.mockImplementation((async (cmd: string, args?: readonly string[]) => {
      if (cmd === 'gh' && args?.[0] === '--version') {
        return execaResult({ stdout: 'gh version 2.0.0' });
      }
      if (cmd === 'gh' && args?.[0] === 'auth') {
        return execaResult({ stdout: 'Logged in' });
      }
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '--show-current') {
        return execaResult({ stdout: 'feature/my-feature' });
      }
      if (cmd === 'git' && args?.[0] === 'remote' && args?.[1] === 'show') {
        return execaResult({ stdout: 'HEAD branch: main' });
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '--oneline') {
        return execaResult({ stdout: '' }); // No unpushed commits
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '-1') {
        return execaResult({ stdout: 'Add new feature' }); // Last commit message
      }
      if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'create') {
        return execaResult({ stdout: 'https://github.com/owner/repo/pull/124' });
      }
      return execaResult({ stdout: '' });
    }) as unknown as Parameters<typeof execaMock.mockImplementation>[0]);

    // Mock prompts
    inputMock.mockResolvedValueOnce('My custom title'); // title prompt
    confirmMock.mockResolvedValueOnce(false); // body (wantBody) prompt

    // Mock draft selection
    promptSelectMock.mockResolvedValueOnce('ready');

    const result = await executeGhPrCreate({});

    expect(result.success).toBe(true);
    expect(inputMock).toHaveBeenCalled();
  });

  it('should prompt to push when there are unpushed commits', async () => {
    const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');

    execaMock.mockImplementation((async (cmd: string, args?: readonly string[]) => {
      if (cmd === 'gh' && args?.[0] === '--version') {
        return execaResult({ stdout: 'gh version 2.0.0' });
      }
      if (cmd === 'gh' && args?.[0] === 'auth') {
        return execaResult({ stdout: 'Logged in' });
      }
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '--show-current') {
        return execaResult({ stdout: 'feature/unpushed' });
      }
      if (cmd === 'git' && args?.[0] === 'remote' && args?.[1] === 'show') {
        return execaResult({ stdout: 'HEAD branch: main' });
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '--oneline') {
        return execaResult({ stdout: 'abc123 Some commit' }); // Has unpushed commits
      }
      if (cmd === 'git' && args?.[0] === 'ls-remote') {
        return execaResult({ stdout: 'refs/heads/feature/unpushed' }); // Branch exists on remote
      }
      if (cmd === 'git' && args?.[0] === 'push') {
        return execaResult({ stdout: 'pushed' });
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '-1') {
        return execaResult({ stdout: 'Some commit' });
      }
      if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'create') {
        return execaResult({ stdout: 'https://github.com/owner/repo/pull/125' });
      }
      return execaResult({ stdout: '' });
    }) as unknown as Parameters<typeof execaMock.mockImplementation>[0]);

    // Mock prompts: confirm fires for push (1st) then wantBody (2nd)
    confirmMock
      .mockResolvedValueOnce(true) // push confirmation
      .mockResolvedValueOnce(false); // body (wantBody)
    inputMock.mockResolvedValueOnce('Test PR'); // title

    promptSelectMock.mockResolvedValueOnce('ready');

    const result = await executeGhPrCreate({});

    expect(result.success).toBe(true);

    // Verify push was called
    const pushCall = execaMock.mock.calls.find(
      ([cmd, args]) => cmd === 'git' && Array.isArray(args) && args[0] === 'push'
    );
    expect(pushCall).toBeTruthy();
  });

  it('should handle PR already exists error', async () => {
    const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');

    execaMock.mockImplementation((async (cmd: string, args?: readonly string[]) => {
      if (cmd === 'gh' && args?.[0] === '--version') {
        return execaResult({ stdout: 'gh version 2.0.0' });
      }
      if (cmd === 'gh' && args?.[0] === 'auth') {
        return execaResult({ stdout: 'Logged in' });
      }
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '--show-current') {
        return execaResult({ stdout: 'feature/existing-pr' });
      }
      if (cmd === 'git' && args?.[0] === 'remote' && args?.[1] === 'show') {
        return execaResult({ stdout: 'HEAD branch: main' });
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '--oneline') {
        return execaResult({ stdout: '' }); // No unpushed commits
      }
      if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'create') {
        throw new Error('a pull request for branch "feature/existing-pr" already exists');
      }
      return execaResult({ stdout: '' });
    }) as unknown as Parameters<typeof execaMock.mockImplementation>[0]);

    const result = await executeGhPrCreate({
      title: 'Test PR',
      body: 'Test body',
      base: 'main',
      draft: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('already exists');
    }
  });

  it('should create command with correct options', async () => {
    const { createPrCreateCommand } = await import('@/commands/gh/pr/create/index.js');

    const command = createPrCreateCommand();

    expect(command.name()).toBe('create');
    expect(command.description()).toBe('Create a pull request on GitHub');

    const options = command.options.map((o) => o.flags);
    expect(options).toContain('-t, --title <title>');
    expect(options).toContain('-b, --body <body>');
    expect(options).toContain('-B, --base <branch>');
    expect(options).toContain('-d, --draft');
    expect(options).toContain('-r, --reviewer <reviewers...>');
    expect(options).toContain('-l, --label <labels...>');
    expect(options).toContain('-w, --web');
  });

  describe('agent-friendly runs (--yes / --non-interactive)', () => {
    let tempDir: TempDir;
    let cwdSpy: ReturnType<typeof vi.spyOn>;
    let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      tempDir = await createTempDir('neo-pr-create-');
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir.path);
      stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(async () => {
      cwdSpy.mockRestore();
      stdoutWriteSpy.mockRestore();
      await tempDir.cleanup();
    });

    it('takes the title from the last commit instead of prompting under --yes', async () => {
      const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');
      setRuntimeContext(buildRuntimeContext({ yes: true }));

      mockPrScenario({ branch: 'jacek/add-widget', lastCommit: 'feat: add the widget' });
      promptSelectMock.mockResolvedValue('ready');

      const result = await executeGhPrCreate({});

      expect(result.success).toBe(true);
      expect(inputMock).not.toHaveBeenCalled();
      expect(prCreateCall()?.[1]).toEqual([
        'pr',
        'create',
        '--title',
        'feat: add the widget',
        '--base',
        'main',
        '--body',
        '',
      ]);
    });

    it('falls back to a branch-derived title when the last commit lookup fails', async () => {
      const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');
      setRuntimeContext(buildRuntimeContext({ yes: true }));

      mockPrScenario({ branch: 'feature/add-nav-bar', lastCommit: new Error('no commits yet') });
      promptSelectMock.mockResolvedValue('ready');

      const result = await executeGhPrCreate({});

      expect(result.success).toBe(true);
      expect(inputMock).not.toHaveBeenCalled();
      expect(prCreateCall()?.[1]).toEqual([
        'pr',
        'create',
        '--title',
        'Add nav bar',
        '--base',
        'main',
        '--body',
        '',
      ]);
    });

    it('pushes a branch missing from the remote without asking under --yes', async () => {
      const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');
      setRuntimeContext(buildRuntimeContext({ yes: true }));

      mockPrScenario({ branch: 'jacek/unpushed', unpushed: true, remoteBranch: false });
      promptSelectMock.mockResolvedValue('ready');

      const result = await executeGhPrCreate({ title: 'Ship it', body: 'why' });

      expect(result.success).toBe(true);
      expect(confirmMock).not.toHaveBeenCalled();
      expect(warnMock).toHaveBeenCalledWith('Branch has not been pushed to remote yet');
      expect(pushCall()?.[1]).toEqual(['push', '-u', 'origin', 'jacek/unpushed']);
      expect(spinnerMock.succeed).toHaveBeenCalledWith('Pushed to remote');
    });

    it('auto-pushes, auto-titles and auto-bodies under --non-interactive without --yes', async () => {
      const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

      mockPrScenario({ branch: 'jacek/ni', unpushed: true, lastCommit: 'chore: tidy up' });
      promptSelectMock.mockResolvedValue('ready');

      const result = await executeGhPrCreate({});

      expect(result.success).toBe(true);
      expect(confirmMock).not.toHaveBeenCalled();
      expect(inputMock).not.toHaveBeenCalled();
      expect(editorMock).not.toHaveBeenCalled();
      expect(warnMock).toHaveBeenCalledWith('You have unpushed commits');
      expect(pushCall()?.[1]).toEqual(['push', 'origin', 'jacek/ni']);
      expect(prCreateCall()?.[1]).toEqual([
        'pr',
        'create',
        '--title',
        'chore: tidy up',
        '--base',
        'main',
        '--body',
        '',
      ]);
    });

    it('uses the PR template as the body when one exists', async () => {
      const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');
      const template = '## Summary\n\n- [ ] tests\n';
      await fs.mkdir(path.join(tempDir.path, '.github'), { recursive: true });
      await fs.writeFile(path.join(tempDir.path, '.github', 'PULL_REQUEST_TEMPLATE.md'), template);
      setRuntimeContext(buildRuntimeContext({ yes: true }));

      mockPrScenario({ branch: 'jacek/templated', lastCommit: 'feat: templated' });
      promptSelectMock.mockResolvedValue('ready');

      const result = await executeGhPrCreate({});

      expect(result.success).toBe(true);
      expect(editorMock).not.toHaveBeenCalled();
      expect(infoMock).toHaveBeenCalledWith('Found PR template');
      expect(prCreateCall()?.[1]).toEqual([
        'pr',
        'create',
        '--title',
        'feat: templated',
        '--base',
        'main',
        '--body',
        template,
      ]);
    });

    it('emits the JSON envelope under --json --yes', async () => {
      const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');
      setRuntimeContext(buildRuntimeContext({ json: true, yes: true }));

      mockPrScenario({
        branch: 'jacek/json',
        lastCommit: 'feat: json envelope',
        prUrl: 'https://github.com/owner/repo/pull/321',
      });
      promptSelectMock.mockResolvedValue('ready');

      const result = await executeGhPrCreate({ reviewer: ['octocat'], label: ['bug'] });

      expect(result.success).toBe(true);
      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toEqual({
        ok: true,
        command: 'gh.pr.create',
        url: 'https://github.com/owner/repo/pull/321',
        title: 'feat: json envelope',
        base: 'main',
        draft: false,
        reviewers: ['octocat'],
        labels: ['bug'],
      });
      expect(prCreateCall()?.[1]).toEqual([
        'pr',
        'create',
        '--title',
        'feat: json envelope',
        '--base',
        'main',
        '--body',
        '',
        '--reviewer',
        'octocat',
        '--label',
        'bug',
      ]);
    });
  });

  describe('push failures', () => {
    function pushRejection(stderr: string, exitCode = 1): Error {
      return Object.assign(new Error(`Command failed with exit code ${exitCode}: git push`), {
        stderr,
        exitCode,
      });
    }

    it('classifies a non-fast-forward rejection', async () => {
      const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');
      const stderr = [
        ' ! [rejected]        jacek/behind -> jacek/behind (non-fast-forward)',
        "error: failed to push some refs to 'github.com:owner/repo.git'",
        'hint: Updates were rejected because the tip of your current branch is behind',
      ].join('\n');

      mockPrScenario({
        branch: 'jacek/behind',
        unpushed: true,
        pushError: pushRejection(stderr),
      });
      confirmMock.mockResolvedValueOnce(true);

      const result = await executeGhPrCreate({ title: 'Ship it', body: 'why' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(GitError);
        expect(result.error.code).toBe(GitErrorCode.NON_FAST_FORWARD);
        expect(result.error.message).toBe('Push was rejected because the remote has new commits.');
        expect(result.error.suggestions).toContain('Pull the latest changes: git pull --rebase');
        expect(String(result.error.context?.['stderr'])).toContain('non-fast-forward');
      }
      expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to push to remote');
      expect(prCreateCall()).toBeUndefined();
    });

    it('classifies an authentication failure', async () => {
      const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');
      const stderr = [
        'git@github.com: Permission denied (publickey).',
        'fatal: Could not read from remote repository.',
      ].join('\n');

      mockPrScenario({
        branch: 'jacek/no-keys',
        unpushed: true,
        pushError: pushRejection(stderr, 128),
      });
      confirmMock.mockResolvedValueOnce(true);

      const result = await executeGhPrCreate({ title: 'Ship it', body: 'why' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(GitError);
        expect(result.error.code).toBe(GitErrorCode.AUTHENTICATION_FAILED);
        expect(result.error.message).toBe('Authentication failed!');
        expect(result.error.suggestions).toEqual(['Check your git credentials or SSH keys']);
      }
      expect(prCreateCall()).toBeUndefined();
    });

    it('reports an unrecognized push failure as an unknown git error', async () => {
      const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');

      mockPrScenario({
        branch: 'jacek/hung-up',
        unpushed: true,
        pushError: pushRejection('fatal: the remote end hung up unexpectedly', 128),
      });
      confirmMock.mockResolvedValueOnce(true);

      const result = await executeGhPrCreate({ title: 'Ship it', body: 'why' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(GitError);
        expect(result.error.code).toBe(GitErrorCode.UNKNOWN);
        expect(result.error.message).toBe('Git command failed: gh-pr-create');
      }
      expect(prCreateCall()).toBeUndefined();
    });
  });
});
