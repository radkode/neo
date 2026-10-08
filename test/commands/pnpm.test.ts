import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { createPnpmCommand } from '@/commands/pnpm/index.js';
import { createTempDir, mockProcessExit, type TempDir } from '../utils/test-helpers.js';
import packageJson from '../../package.json' with { type: 'json' };

vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('@/utils/output.js', () => ({ emitError: vi.fn() }));

import { emitError } from '@/utils/output.js';

const execaMock = vi.mocked(execa) as unknown as Mock<
  (
    command: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; stdio: 'inherit'; reject: false }
  ) => Promise<{
    failed: boolean;
    exitCode?: number;
    signal?: string;
  }>
>;

describe('pnpm command', () => {
  let tempDir: TempDir;
  let envFile: string | undefined;
  let program: Command;
  let originalExitCode: typeof process.exitCode;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await createTempDir('neo-pnpm-test-');
    await mkdir(`${tempDir.path}/.git`);
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir.path);
    envFile = `${tempDir.path}/tokens.env`;
    await writeFile(envFile, 'GITHUB_TOKEN="test-github"\nHARNESS_TOKEN=test-harness\n');
    program = new Command().option('--json').option('--verbose').addCommand(createPnpmCommand());
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    execaMock.mockResolvedValue({ failed: false, exitCode: 0 });
    mockProcessExit();
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await tempDir.cleanup();
  });

  async function run(args: string[] = ['install']): Promise<void> {
    const options = envFile ? ['--env-file', envFile] : [];
    await program.parseAsync(['pnpm', ...options, '--', ...args], { from: 'user' });
  }

  it('automatically loads the nearest .env.pnpm.local within the repository', async () => {
    await writeFile(`${tempDir.path}/.env.pnpm.local`, 'GITHUB_TOKEN=root-token\n');
    const child = `${tempDir.path}/packages/app`;
    await mkdir(child, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(child);
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({ GITHUB_TOKEN: 'root-token' });
  });

  it('prefers a closer convention file and does not merge other env files', async () => {
    await writeFile(`${tempDir.path}/.env.pnpm.local`, 'GITHUB_TOKEN=root-token\n');
    const child = `${tempDir.path}/app`;
    await mkdir(child);
    await writeFile(`${child}/.env.pnpm.local`, 'HARNESS_TOKEN=child-token\n');
    await writeFile(`${child}/.env.local`, 'GITHUB_TOKEN=app-only-token\n');
    vi.spyOn(process, 'cwd').mockReturnValue(child);
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({ HARNESS_TOKEN: 'child-token' });
  });

  it('does not load tokens from outside a nested repository boundary', async () => {
    await writeFile(`${tempDir.path}/.env.pnpm.local`, 'GITHUB_TOKEN=outer-token\n');
    const child = `${tempDir.path}/other-repo`;
    await mkdir(`${child}/.git`, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(child);
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({});
  });

  it('recognizes worktree .git files as repository boundaries', async () => {
    await writeFile(`${tempDir.path}/.env.pnpm.local`, 'GITHUB_TOKEN=outer-token\n');
    const child = `${tempDir.path}/worktree`;
    await mkdir(child);
    await writeFile(`${child}/.git`, 'gitdir: /unused/git/path\n');
    vi.spyOn(process, 'cwd').mockReturnValue(child);
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({});
  });

  it('runs pnpm normally when no convention file exists', async () => {
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({});
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('uses an explicit env file instead of the convention file', async () => {
    await writeFile(`${tempDir.path}/.env.pnpm.local`, 'GITHUB_TOKEN=automatic-token\n');
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({
      GITHUB_TOKEN: 'test-github',
      HARNESS_TOKEN: 'test-harness',
    });
  });

  it('passes scoped tokens to a real pnpm script without changing the parent', async () => {
    const { execa: realExeca } = await vi.importActual<typeof import('execa')>('execa');
    const probe =
      'console.log(JSON.stringify({ github: process.env.GITHUB_TOKEN, harness: process.env.HARNESS_TOKEN, pathPresent: Boolean(process.env.PATH) }))';
    await writeFile(join(tempDir.path, 'probe.cjs'), probe);
    await writeFile(
      join(tempDir.path, 'package.json'),
      JSON.stringify({
        name: 'neo-pnpm-probe',
        version: '1.0.0',
        packageManager: packageJson.packageManager,
        scripts: { probe: 'node probe.cjs' },
      })
    );
    vi.stubEnv('GITHUB_TOKEN', 'parent-github');
    vi.stubEnv('HARNESS_TOKEN', undefined);
    let stdout = '';
    let stderr = '';
    let exitCode: number | undefined;
    execaMock.mockImplementationOnce(async (command, args, options) => {
      const result = await realExeca(command, args, {
        ...options,
        cwd: tempDir.path,
        stdio: 'pipe',
      });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
      return result;
    });
    await run(['--silent', 'run', 'probe']);
    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      github: 'test-github',
      harness: 'test-harness',
      pathPresent: true,
    });
    expect(process.env.GITHUB_TOKEN).toBe('parent-github');
    expect(process.env.HARNESS_TOKEN).toBeUndefined();
  });

  it('supplies tokens only to the child without modifying the parent environment', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'parent-github');
    vi.stubEnv('HARNESS_TOKEN', undefined);
    await run();

    expect(execa).toHaveBeenCalledWith('pnpm', ['install'], {
      env: { GITHUB_TOKEN: 'test-github', HARNESS_TOKEN: 'test-harness' },
      stdio: 'inherit',
      reject: false,
    });
    expect(process.env.GITHUB_TOKEN).toBe('parent-github');
    expect(process.env.HARNESS_TOKEN).toBeUndefined();
    expect(process.exitCode).toBeUndefined();
  });

  it('forwards pnpm options, separators, and spaced arguments unchanged', async () => {
    const args = [
      '--filter',
      'workspace name',
      'run',
      'test',
      '--',
      '--json',
      '--verbose',
      '--help',
    ];
    await run(args);
    expect(execaMock.mock.calls[0]?.[1]).toEqual(args);
    expect(program.opts()).toEqual({});
  });

  it('runs bare pnpm when no arguments are supplied', async () => {
    await run([]);
    expect(execaMock.mock.calls[0]?.[1]).toEqual([]);
  });

  it('preserves the pnpm failure exit code', async () => {
    execaMock.mockResolvedValue({ failed: true, exitCode: 7 });
    await run();
    expect(process.exitCode).toBe(7);
    expect(emitError).not.toHaveBeenCalled();
  });

  it('preserves signal termination as a shell exit code', async () => {
    execaMock.mockResolvedValue({ failed: true, signal: 'SIGTERM' });
    await run();
    expect(process.exitCode).toBe(143);
  });

  it('fails safely before launching pnpm when the file is missing', async () => {
    envFile = `${tempDir.path}/missing.env`;
    await run();
    expect(execa).not.toHaveBeenCalled();
    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Unable to read environment file'),
      })
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('does not report child errors that might contain secrets', async () => {
    execaMock.mockRejectedValue(new Error('test-github test-harness'));
    await run();
    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Unable to start pnpm. Check that it is installed and available on PATH.',
      })
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
