import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import {
  createExecaMock,
  createPromptsMock,
  createUiMock,
  failureResult,
  mockProcessExit,
  successResult,
  type ExecaResponse,
  type UiMock,
} from '../../utils/test-helpers.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@/utils/ui.js', () => ({
  ui: { ...createUiMock(), section: vi.fn() },
}));

vi.mock('@/services/ai/index.js', () => ({ generatePrDescription: vi.fn() }));

vi.mock('@inquirer/prompts', () => createPromptsMock({ confirm: true }));

import { confirm } from '@inquirer/prompts';
import { createAiPrCommand, executeAiPr } from '@/commands/ai/pr/index.js';
import { generatePrDescription } from '@/services/ai/index.js';
import { ui } from '@/utils/ui.js';
import { CommandError, ErrorCategory } from '@/core/errors/index.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';

const BRANCH = 'jacek/widget';
const TITLE = 'feat: add widget';
const BODY = 'Adds the widget and wires it into the toolbar.';
const PR_URL = 'https://github.com/radkode/neo/pull/99';
const DIFF = 'diff --git a/src/widget.ts b/src/widget.ts\n+widget\n';

const execaMock = vi.mocked(execa);
const generateMock = vi.mocked(generatePrDescription);
const confirmMock = vi.mocked(confirm);
const uiMock = ui as unknown as UiMock & { section: ReturnType<typeof vi.fn> };

const baseResponses: Record<string, ExecaResponse | Error> = {
  'git branch --show-current': { stdout: `${BRANCH}\n` },
  'git symbolic-ref refs/remotes/origin/HEAD': { stdout: 'refs/remotes/origin/main\n' },
  'git log origin/main..HEAD': { stdout: 'abc1234 feat: add widget\nDetails about the widget\n' },
  'git diff origin/main...HEAD --stat': { stdout: ' src/widget.ts | 2 +-\n' },
  'git diff origin/main...HEAD': { stdout: DIFF },
  'gh --version': { stdout: 'gh version 2.62.0' },
  'gh pr view': { stdout: '' },
  'gh pr create': { stdout: PR_URL },
};

function useExeca(overrides: Record<string, ExecaResponse | Error> = {}): void {
  const impl = createExecaMock({ responses: { ...baseResponses, ...overrides } });
  execaMock.mockImplementation(
    impl as unknown as Parameters<typeof execaMock.mockImplementation>[0]
  );
}

type ExecaCall = [string, string[]];

function callsTo(command: string): ExecaCall[] {
  return (execaMock.mock.calls as unknown as ExecaCall[]).filter(
    ([cmd, args]) => cmd === command && Array.isArray(args)
  );
}

function ghCreateCall(): ExecaCall | undefined {
  return callsTo('gh').find(([, args]) => args[0] === 'pr' && args[1] === 'create');
}

function gitArgs(subcommand: string): string[] | undefined {
  return callsTo('git').find(([, args]) => args[0] === subcommand)?.[1];
}

describe('executeAiPr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExeca();
    generateMock.mockResolvedValue(successResult({ title: TITLE, body: BODY }));
    confirmMock.mockResolvedValue(true);
    setRuntimeContext(buildRuntimeContext({ nonInteractive: false, yes: false }));
  });

  afterEach(() => {
    setRuntimeContext(buildRuntimeContext());
  });

  it('resolves the base branch from the origin HEAD symbolic ref', async () => {
    const result = await executeAiPr({ create: false });

    expect(result.base).toBe('main');
    expect(result.branch).toBe(BRANCH);
    expect(gitArgs('log')).toEqual([
      'log',
      'origin/main..HEAD',
      '--pretty=format:%h %s%n%b',
      '--reverse',
    ]);
  });

  it('honors an explicit base without probing origin HEAD', async () => {
    useExeca({
      'git log origin/develop..HEAD': { stdout: 'abc1234 feat: add widget\n' },
      'git diff origin/develop...HEAD --stat': { stdout: ' src/widget.ts | 2 +-\n' },
      'git diff origin/develop...HEAD': { stdout: DIFF },
    });

    const result = await executeAiPr({ base: 'develop', create: false });

    expect(result.base).toBe('develop');
    expect(gitArgs('symbolic-ref')).toBeUndefined();
    expect(gitArgs('log')?.[1]).toBe('origin/develop..HEAD');
  });

  it('falls back to probing origin/main then origin/master', async () => {
    useExeca({
      'git symbolic-ref refs/remotes/origin/HEAD': new Error(
        'fatal: ref HEAD is not a symbolic ref'
      ),
      'git show-ref --verify --quiet refs/remotes/origin/main': new Error('exit code 1'),
      'git show-ref --verify --quiet refs/remotes/origin/master': { stdout: '' },
      'git log origin/master..HEAD': { stdout: 'abc1234 feat: add widget\n' },
      'git diff origin/master...HEAD --stat': { stdout: ' src/widget.ts | 2 +-\n' },
      'git diff origin/master...HEAD': { stdout: DIFF },
    });

    const result = await executeAiPr({ create: false });

    expect(result.base).toBe('master');
    expect(callsTo('git').filter(([, args]) => args[0] === 'show-ref')).toHaveLength(2);
  });

  it('throws AI_PR_NO_DEFAULT_BRANCH when neither probe resolves', async () => {
    useExeca({
      'git symbolic-ref refs/remotes/origin/HEAD': new Error(
        'fatal: ref HEAD is not a symbolic ref'
      ),
      'git show-ref --verify --quiet refs/remotes/origin/main': new Error('exit code 1'),
      'git show-ref --verify --quiet refs/remotes/origin/master': new Error('exit code 1'),
    });

    await expect(executeAiPr({})).rejects.toMatchObject({
      code: 'AI_PR_NO_DEFAULT_BRANCH',
      category: ErrorCategory.CONFIGURATION,
      message: 'Could not detect default branch.',
      suggestions: ['Pass --base <name>', 'Or run: git remote set-head origin --auto'],
    });
  });

  it('throws AI_PR_DETACHED_HEAD when no branch is checked out', async () => {
    useExeca({ 'git branch --show-current': { stdout: '\n' } });

    await expect(executeAiPr({})).rejects.toMatchObject({
      code: 'AI_PR_DETACHED_HEAD',
      category: ErrorCategory.VALIDATION,
    });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('classifies a failing git read through detectGitError', async () => {
    useExeca({
      'git branch --show-current': Object.assign(new Error('Command failed with exit code 128'), {
        stderr: 'fatal: not a git repository (or any of the parent directories): .git',
        exitCode: 128,
      }),
    });

    await expect(executeAiPr({})).rejects.toMatchObject({
      code: 'GIT_NOT_A_REPOSITORY',
      message: 'Not a git repository!',
      commandName: 'ai-pr',
    });
  });

  it('throws AI_PR_ON_BASE_BRANCH when already on the base branch', async () => {
    useExeca({ 'git branch --show-current': { stdout: 'main\n' } });

    await expect(executeAiPr({})).rejects.toMatchObject({
      code: 'AI_PR_ON_BASE_BRANCH',
      context: { base: 'main' },
    });
    await expect(executeAiPr({})).rejects.toThrow(/Already on base branch "main"/);
  });

  it('throws AI_PR_NO_COMMITS when the branch is not ahead of the base', async () => {
    useExeca({ 'git log origin/main..HEAD': { stdout: '' } });

    const rejection = executeAiPr({});

    await expect(rejection).rejects.toMatchObject({
      code: 'AI_PR_NO_COMMITS',
      message: `No commits on ${BRANCH} that aren't already on origin/main.`,
      context: { branch: BRANCH, base: 'main' },
      suggestions: ['Commit your work: neo git commit', 'Then push it: neo git push'],
    });
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('counts only sha-prefixed log lines as commits', async () => {
    useExeca({
      'git log origin/main..HEAD': {
        stdout: 'abc1234 first change\nbody one\n\ndef5678 second change\nbody two',
      },
    });

    const result = await executeAiPr({ create: false });

    expect(result.commits).toBe(2);
  });

  it('passes the branch, commits, diffstat and diff to the AI service', async () => {
    await executeAiPr({ create: false });

    expect(generateMock).toHaveBeenCalledWith({
      branchName: BRANCH,
      baseBranch: 'main',
      commits: ['abc1234 feat: add widget', 'Details about the widget'],
      diffStat: 'src/widget.ts | 2 +-',
      diff: DIFF,
    });
  });

  it('rethrows the AI failure and fails the spinner', async () => {
    const aiError = new CommandError('Anthropic API key not configured', 'ai', {
      code: 'AI_NO_API_KEY',
    });
    generateMock.mockResolvedValue(failureResult(aiError));

    await expect(executeAiPr({})).rejects.toBe(aiError);
    expect(uiMock._spinner.fail).toHaveBeenCalledWith('PR description generation failed');
    expect(callsTo('gh')).toHaveLength(0);
  });

  it('skips gh entirely when create is false', async () => {
    const result = await executeAiPr({ create: false });

    expect(result).toEqual({
      title: TITLE,
      body: BODY,
      base: 'main',
      branch: BRANCH,
      commits: 1,
      created: false,
    });
    expect(callsTo('gh')).toHaveLength(0);
  });

  it('warns and skips creation when gh is not installed', async () => {
    useExeca({ 'gh --version': new Error('spawn gh ENOENT') });

    const result = await executeAiPr({});

    expect(result.created).toBe(false);
    expect(result.prUrl).toBeUndefined();
    expect(uiMock.warn).toHaveBeenCalledWith(expect.stringContaining('gh CLI not found'));
    expect(ghCreateCall()).toBeUndefined();
  });

  it('reports the existing PR instead of opening a second one', async () => {
    const existing = 'https://github.com/radkode/neo/pull/42';
    useExeca({ 'gh pr view': { stdout: `${existing}\n` } });

    const result = await executeAiPr({});

    expect(result).toMatchObject({ created: false, prUrl: existing });
    expect(uiMock.warn).toHaveBeenCalledWith(`PR already exists for this branch: ${existing}`);
    expect(ghCreateCall()).toBeUndefined();
  });

  it('creates the PR with the generated title and body', async () => {
    setRuntimeContext(buildRuntimeContext({ yes: true }));

    const result = await executeAiPr({});

    expect(ghCreateCall()?.[1]).toEqual([
      'pr',
      'create',
      '--base',
      'main',
      '--title',
      TITLE,
      '--body',
      BODY,
    ]);
    expect(result).toMatchObject({ created: true, prUrl: PR_URL });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(uiMock._spinner.succeed).toHaveBeenCalledWith(`Created PR: ${PR_URL}`);
  });

  it('appends --draft when the draft option is set', async () => {
    setRuntimeContext(buildRuntimeContext({ yes: true }));

    await executeAiPr({ draft: true });

    expect(ghCreateCall()?.[1]?.at(-1)).toBe('--draft');
  });

  it('previews the description and creates after an interactive confirmation', async () => {
    const result = await executeAiPr({});

    expect(uiMock.section).toHaveBeenCalledWith('Preview');
    expect(uiMock.muted).toHaveBeenCalledWith(`Title: ${TITLE}`);
    expect(confirmMock).toHaveBeenCalledWith({ message: 'Create PR?', default: true });
    expect(result.created).toBe(true);
  });

  it('skips creation when the interactive confirmation is declined', async () => {
    confirmMock.mockResolvedValue(false);

    const result = await executeAiPr({});

    expect(result.created).toBe(false);
    expect(uiMock.muted).toHaveBeenCalledWith('Skipped PR creation.');
    expect(ghCreateCall()).toBeUndefined();
  });

  it('throws AI_PR_GH_CREATE_FAILED with the stderr tail', async () => {
    setRuntimeContext(buildRuntimeContext({ yes: true }));
    const stderr = 'pull request create failed: GraphQL: No commits between main and the branch';
    useExeca({
      'gh pr create': Object.assign(new Error('Command failed with exit code 1'), {
        stderr,
        exitCode: 1,
      }),
    });

    await expect(executeAiPr({})).rejects.toMatchObject({
      code: 'AI_PR_GH_CREATE_FAILED',
      message: 'gh pr create failed. Run with --json to inspect the generated title/body.',
      context: { base: 'main', branch: BRANCH, exitCode: 1, stderr },
    });
    expect(uiMock._spinner.fail).toHaveBeenCalledWith('Failed to create PR');
    expect(uiMock.muted).toHaveBeenCalledWith(stderr);
  });
});

describe('createAiPrCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    useExeca();
    generateMock.mockResolvedValue(successResult({ title: TITLE, body: BODY }));
    confirmMock.mockResolvedValue(true);
    setRuntimeContext(buildRuntimeContext({ nonInteractive: false, yes: false }));
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    exitMock.mockRestore();
    setRuntimeContext(buildRuntimeContext());
  });

  function emittedJson(): Record<string, unknown> {
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    return JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
  }

  it('registers the pr command with its public options', () => {
    const command = createAiPrCommand();

    expect(command.name()).toBe('pr');
    expect(command.options.map(({ flags }) => flags)).toEqual([
      '--base <branch>',
      '--draft',
      '--no-create',
    ]);
  });

  it('forces no-create in JSON mode without --yes', async () => {
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createAiPrCommand().parseAsync([], { from: 'user' });

    expect(emittedJson()).toEqual({
      ok: true,
      command: 'ai pr',
      branch: BRANCH,
      base: 'main',
      commits: 1,
      title: TITLE,
      body: BODY,
      created: false,
    });
    expect(callsTo('gh')).toHaveLength(0);
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('creates the PR in JSON mode when --yes opted in', async () => {
    setRuntimeContext(buildRuntimeContext({ json: true, yes: true }));

    await createAiPrCommand().parseAsync([], { from: 'user' });

    expect(emittedJson()).toMatchObject({ ok: true, created: true, prUrl: PR_URL });
    expect(ghCreateCall()).toBeDefined();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('exits 2 without touching git when a non-interactive run needs the confirmation', async () => {
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

    await createAiPrCommand().parseAsync([], { from: 'user' });

    expect(exitMock).toHaveBeenNthCalledWith(1, 2);
    expect(uiMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Interactive prompt required in non-interactive mode')
    );
    expect(uiMock.error).toHaveBeenCalledWith(expect.stringContaining('--yes (or --no-create'));
    expect(execaMock).not.toHaveBeenCalled();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('renders the generated description under --no-create in a non-interactive run', async () => {
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

    await createAiPrCommand().parseAsync(['--no-create'], { from: 'user' });

    expect(exitMock).not.toHaveBeenCalled();
    expect(uiMock.section).toHaveBeenCalledWith('Generated PR');
    expect(uiMock.muted).toHaveBeenCalledWith(`Title: ${TITLE}`);
    expect(uiMock.muted).toHaveBeenCalledWith(BODY);
    expect(callsTo('gh')).toHaveLength(0);
  });

  it('reports the opened PR url in text mode', async () => {
    setRuntimeContext(buildRuntimeContext({ yes: true }));

    await createAiPrCommand().parseAsync([], { from: 'user' });

    expect(uiMock.success).toHaveBeenCalledWith(`PR opened: ${PR_URL}`);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
