import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import { createPnpmCommand } from '@/commands/pnpm/index.js';
import { createYarnCommand } from '@/commands/yarn/index.js';
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
    code?: string | undefined;
  }>
>;

interface ToolCase {
  tool: 'pnpm' | 'yarn';
  otherTool: 'pnpm' | 'yarn';
  create: () => Command;
  /** Extra package.json fields for the real-execution probe project. */
  probeManifest: Record<string, unknown>;
}

const TOOLS: ToolCase[] = [
  {
    tool: 'pnpm',
    otherTool: 'yarn',
    create: createPnpmCommand,
    probeManifest: { packageManager: packageJson.packageManager },
  },
  {
    tool: 'yarn',
    otherTool: 'pnpm',
    create: createYarnCommand,
    probeManifest: { license: 'MIT' },
  },
];

describe.each(TOOLS)('$tool command', ({ tool, otherTool, create, probeManifest }) => {
  const conventionFile = `.env.${tool}.local`;
  const startError = `Unable to start ${tool}. Check that it is installed and available on PATH.`;
  let tempDir: TempDir;
  let envFile: string | undefined;
  let program: Command;
  let originalExitCode: typeof process.exitCode;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await createTempDir(`neo-${tool}-test-`);
    await mkdir(`${tempDir.path}/.git`);
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir.path);
    envFile = `${tempDir.path}/tokens.env`;
    await writeFile(envFile, 'GITHUB_TOKEN="test-github"\nHARNESS_TOKEN=test-harness\n');
    program = new Command().option('--json').option('--verbose').addCommand(create());
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
    await program.parseAsync([tool, ...options, '--', ...args], { from: 'user' });
  }

  it('documents its own convention file', () => {
    const command = program.commands[0];
    expect(command?.name()).toBe(tool);
    expect(command?.description()).toBe(
      `Run ${tool} with environment variables scoped to its child process`
    );
    expect(command?.options.map((option) => option.description)).toEqual([
      `override automatic repository-local ${conventionFile} discovery`,
    ]);
  });

  it(`automatically loads the nearest ${conventionFile} within the repository`, async () => {
    await writeFile(`${tempDir.path}/${conventionFile}`, 'GITHUB_TOKEN=root-token\n');
    const child = `${tempDir.path}/packages/app`;
    await mkdir(child, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(child);
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({ GITHUB_TOKEN: 'root-token' });
  });

  it(`does not load the ${otherTool} convention file or .env.local`, async () => {
    await writeFile(`${tempDir.path}/.env.${otherTool}.local`, 'GITHUB_TOKEN=other-token\n');
    await writeFile(`${tempDir.path}/.env.local`, 'GITHUB_TOKEN=app-only-token\n');
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({});
  });

  it('prefers a closer convention file and does not merge other env files', async () => {
    await writeFile(`${tempDir.path}/${conventionFile}`, 'GITHUB_TOKEN=root-token\n');
    const child = `${tempDir.path}/app`;
    await mkdir(child);
    await writeFile(`${child}/${conventionFile}`, 'HARNESS_TOKEN=child-token\n');
    await writeFile(`${child}/.env.local`, 'GITHUB_TOKEN=app-only-token\n');
    vi.spyOn(process, 'cwd').mockReturnValue(child);
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({ HARNESS_TOKEN: 'child-token' });
  });

  it('does not load tokens from outside a nested repository boundary', async () => {
    await writeFile(`${tempDir.path}/${conventionFile}`, 'GITHUB_TOKEN=outer-token\n');
    const child = `${tempDir.path}/other-repo`;
    await mkdir(`${child}/.git`, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(child);
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({});
  });

  it('recognizes worktree .git files as repository boundaries', async () => {
    await writeFile(`${tempDir.path}/${conventionFile}`, 'GITHUB_TOKEN=outer-token\n');
    const child = `${tempDir.path}/worktree`;
    await mkdir(child);
    await writeFile(`${child}/.git`, 'gitdir: /unused/git/path\n');
    vi.spyOn(process, 'cwd').mockReturnValue(child);
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({});
  });

  it('checks only the current directory outside a repository', async () => {
    const outside = await createTempDir(`neo-${tool}-outside-test-`);
    try {
      await writeFile(`${outside.path}/${conventionFile}`, 'GITHUB_TOKEN=parent-token\n');
      const child = `${outside.path}/project`;
      await mkdir(child);
      vi.spyOn(process, 'cwd').mockReturnValue(child);
      envFile = undefined;
      await run();
      expect(execaMock.mock.lastCall?.[2]?.env).toEqual({});

      vi.spyOn(process, 'cwd').mockReturnValue(outside.path);
      await run();
      expect(execaMock.mock.lastCall?.[2]?.env).toEqual({ GITHUB_TOKEN: 'parent-token' });
    } finally {
      await outside.cleanup();
    }
  });

  it(`runs ${tool} normally when no convention file exists`, async () => {
    envFile = undefined;
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({});
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('uses an explicit env file instead of the convention file', async () => {
    await writeFile(`${tempDir.path}/${conventionFile}`, 'GITHUB_TOKEN=automatic-token\n');
    await run();
    expect(execaMock.mock.lastCall?.[2]?.env).toEqual({
      GITHUB_TOKEN: 'test-github',
      HARNESS_TOKEN: 'test-harness',
    });
  });

  it(`passes scoped tokens to a real ${tool} script without changing the parent`, async () => {
    const { execa: realExeca } = await vi.importActual<typeof import('execa')>('execa');
    const probe =
      'console.log(JSON.stringify({ github: process.env.GITHUB_TOKEN, harness: process.env.HARNESS_TOKEN, pathPresent: Boolean(process.env.PATH) }))';
    await writeFile(join(tempDir.path, 'probe.cjs'), probe);
    await writeFile(
      join(tempDir.path, 'package.json'),
      JSON.stringify({
        name: `neo-${tool}-probe`,
        version: '1.0.0',
        ...probeManifest,
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
  }, 60_000);

  it('supplies tokens only to the child without modifying the parent environment', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'parent-github');
    vi.stubEnv('HARNESS_TOKEN', undefined);
    await run();

    expect(execa).toHaveBeenCalledWith(tool, ['install'], {
      env: { GITHUB_TOKEN: 'test-github', HARNESS_TOKEN: 'test-harness' },
      stdio: 'inherit',
      reject: false,
    });
    expect(process.env.GITHUB_TOKEN).toBe('parent-github');
    expect(process.env.HARNESS_TOKEN).toBeUndefined();
    expect(process.exitCode).toBeUndefined();
  });

  it(`forwards ${tool} options, separators, and spaced arguments unchanged`, async () => {
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

  it(`runs bare ${tool} when no arguments are supplied`, async () => {
    await run([]);
    expect(execaMock.mock.calls[0]?.[1]).toEqual([]);
  });

  it(`preserves the ${tool} failure exit code`, async () => {
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

  it(`fails safely before launching ${tool} when the file is missing`, async () => {
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
    expect(emitError).toHaveBeenCalledWith(expect.objectContaining({ message: startError }));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it(`reports a missing ${tool} executable instead of exiting silently`, async () => {
    execaMock.mockResolvedValue({ failed: true, code: 'ENOENT' });
    await run();
    expect(emitError).toHaveBeenCalledWith(expect.objectContaining({ message: startError }));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it(`reports the generic message when the real ${tool} executable is not on PATH`, async () => {
    const { execa: realExeca } = await vi.importActual<typeof import('execa')>('execa');
    const emptyBin = `${tempDir.path}/empty-bin`;
    await mkdir(emptyBin);
    vi.stubEnv('PATH', emptyBin);
    execaMock.mockImplementationOnce((command, args, options) =>
      realExeca(command, args, { ...options, cwd: tempDir.path, stdio: 'pipe' })
    );
    await run();
    expect(emitError).toHaveBeenCalledWith(expect.objectContaining({ message: startError }));
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
