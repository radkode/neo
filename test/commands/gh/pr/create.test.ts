import { execa } from 'execa';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promptSelect } from '@/utils/prompt.js';
import inquirer from 'inquirer';

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

vi.mock('inquirer', () => {
  const inquirer = { prompt: vi.fn() };
  return { default: inquirer };
});

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
  },
}));

describe('gh pr create command', () => {
  const execaMock = vi.mocked(execa);
  const promptSelectMock = vi.mocked(promptSelect);
  const inquirerMock = vi.mocked(inquirer);
  let exitMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    spinnerMock.start.mockClear();
    spinnerMock.stop.mockClear();
    spinnerMock.succeed.mockClear();
    spinnerMock.fail.mockClear();
    spinnerMock.text = '';
  });

  afterEach(() => {
    exitMock.mockRestore();
    vi.resetAllMocks();
  });

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
    execaMock.mockResolvedValueOnce({ stdout: 'gh version 2.0.0' });
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
    execaMock.mockResolvedValueOnce({ stdout: 'gh version 2.0.0' });
    // gh auth status succeeds
    execaMock.mockResolvedValueOnce({ stdout: 'Logged in' });
    // git branch --show-current returns main
    execaMock.mockResolvedValueOnce({ stdout: 'main' });
    // git remote show origin returns main as HEAD branch
    execaMock.mockResolvedValueOnce({ stdout: 'HEAD branch: main' });

    const result = await executeGhPrCreate({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Cannot create PR from main branch');
    }
  });

  it('should create PR successfully with all options provided', async () => {
    const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');

    execaMock.mockImplementation(async (cmd: string, args?: readonly string[]) => {
      if (cmd === 'gh' && args?.[0] === '--version') {
        return { stdout: 'gh version 2.0.0' };
      }
      if (cmd === 'gh' && args?.[0] === 'auth') {
        return { stdout: 'Logged in' };
      }
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '--show-current') {
        return { stdout: 'feature/test-branch' };
      }
      if (cmd === 'git' && args?.[0] === 'remote' && args?.[1] === 'show') {
        return { stdout: 'HEAD branch: main' };
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '--oneline') {
        return { stdout: '' }; // No unpushed commits
      }
      if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'create') {
        return { stdout: 'https://github.com/owner/repo/pull/123' };
      }
      return { stdout: '' };
    });

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

    execaMock.mockImplementation(async (cmd: string, args?: readonly string[]) => {
      if (cmd === 'gh' && args?.[0] === '--version') {
        return { stdout: 'gh version 2.0.0' };
      }
      if (cmd === 'gh' && args?.[0] === 'auth') {
        return { stdout: 'Logged in' };
      }
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '--show-current') {
        return { stdout: 'feature/my-feature' };
      }
      if (cmd === 'git' && args?.[0] === 'remote' && args?.[1] === 'show') {
        return { stdout: 'HEAD branch: main' };
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '--oneline') {
        return { stdout: '' }; // No unpushed commits
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '-1') {
        return { stdout: 'Add new feature' }; // Last commit message
      }
      if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'create') {
        return { stdout: 'https://github.com/owner/repo/pull/124' };
      }
      return { stdout: '' };
    });

    // Mock inquirer prompts
    inquirerMock.prompt
      .mockResolvedValueOnce({ prTitle: 'My custom title' }) // title prompt
      .mockResolvedValueOnce({ wantBody: false }); // body prompt

    // Mock draft selection
    promptSelectMock.mockResolvedValueOnce('ready');

    const result = await executeGhPrCreate({});

    expect(result.success).toBe(true);
    expect(inquirerMock.prompt).toHaveBeenCalled();
  });

  it('should prompt to push when there are unpushed commits', async () => {
    const { executeGhPrCreate } = await import('@/commands/gh/pr/create/index.js');

    execaMock.mockImplementation(async (cmd: string, args?: readonly string[]) => {
      if (cmd === 'gh' && args?.[0] === '--version') {
        return { stdout: 'gh version 2.0.0' };
      }
      if (cmd === 'gh' && args?.[0] === 'auth') {
        return { stdout: 'Logged in' };
      }
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '--show-current') {
        return { stdout: 'feature/unpushed' };
      }
      if (cmd === 'git' && args?.[0] === 'remote' && args?.[1] === 'show') {
        return { stdout: 'HEAD branch: main' };
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '--oneline') {
        return { stdout: 'abc123 Some commit' }; // Has unpushed commits
      }
      if (cmd === 'git' && args?.[0] === 'ls-remote') {
        return { stdout: 'refs/heads/feature/unpushed' }; // Branch exists on remote
      }
      if (cmd === 'git' && args?.[0] === 'push') {
        return { stdout: 'pushed' };
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '-1') {
        return { stdout: 'Some commit' };
      }
      if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'create') {
        return { stdout: 'https://github.com/owner/repo/pull/125' };
      }
      return { stdout: '' };
    });

    // Mock inquirer prompts
    inquirerMock.prompt
      .mockResolvedValueOnce({ shouldPush: true }) // push confirmation
      .mockResolvedValueOnce({ prTitle: 'Test PR' }) // title
      .mockResolvedValueOnce({ wantBody: false }); // body

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

    execaMock.mockImplementation(async (cmd: string, args?: readonly string[]) => {
      if (cmd === 'gh' && args?.[0] === '--version') {
        return { stdout: 'gh version 2.0.0' };
      }
      if (cmd === 'gh' && args?.[0] === 'auth') {
        return { stdout: 'Logged in' };
      }
      if (cmd === 'git' && args?.[0] === 'branch' && args?.[1] === '--show-current') {
        return { stdout: 'feature/existing-pr' };
      }
      if (cmd === 'git' && args?.[0] === 'remote' && args?.[1] === 'show') {
        return { stdout: 'HEAD branch: main' };
      }
      if (cmd === 'git' && args?.[0] === 'log' && args?.[1] === '--oneline') {
        return { stdout: '' }; // No unpushed commits
      }
      if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'create') {
        throw new Error('a pull request for branch "feature/existing-pr" already exists');
      }
      return { stdout: '' };
    });

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
});
