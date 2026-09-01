import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import { createVerifyCommand, executeVerify } from '@/commands/verify/index.js';
import { CommandError } from '@/core/errors/index.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { createTempDir, mockProcessExit, type TempDir } from '../utils/test-helpers.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@/utils/ui.js', () => ({
  ui: {
    muted: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
    warn: vi.fn(),
  },
}));

import { ui } from '@/utils/ui.js';

const execaMock = vi.mocked(execa);
const warnMock = vi.mocked(ui.warn);

async function writePackage(tempDir: TempDir, manifest: Record<string, unknown>): Promise<void> {
  await writeFile(`${tempDir.path}/package.json`, JSON.stringify(manifest));
}

async function writeLockfile(tempDir: TempDir, name: string): Promise<void> {
  await writeFile(`${tempDir.path}/${name}`, '');
}

describe('executeVerify', () => {
  let tempDir: TempDir;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await createTempDir('neo-verify-test-');
    execaMock.mockResolvedValue({ stdout: '', stderr: '' } as never);
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it('preserves the default verification order without repository configuration', async () => {
    await writePackage(tempDir, {
      scripts: {
        build: 'build',
        test: 'test',
        lint: 'lint',
        typecheck: 'typecheck',
      },
    });

    const result = await executeVerify(tempDir.path, { pm: 'pnpm' });

    expect(result.results.map(({ script }) => script)).toEqual([
      'build',
      'test',
      'lint',
      'typecheck',
    ]);
    expect(execaMock.mock.calls.map(([, args]) => args)).toEqual([
      ['run', 'build'],
      ['run', 'test'],
      ['run', 'lint'],
      ['run', 'typecheck'],
    ]);
  });

  it('uses the repository verification script instead of the default scripts', async () => {
    await writePackage(tempDir, {
      scripts: {
        build: 'next build',
        test: 'vitest',
        'quality:check': 'NEXT_DISABLE_TURBOPACK=1 next build && vitest run',
      },
      neo: { verify: 'quality:check' },
    });

    const result = await executeVerify(tempDir.path, { pm: 'pnpm' });

    expect(result.results.map(({ script }) => script)).toEqual(['quality:check']);
    expect(execaMock).toHaveBeenCalledOnce();
    expect(execaMock).toHaveBeenCalledWith('pnpm', ['run', 'quality:check'], {
      cwd: tempDir.path,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('--only takes precedence over repository verification configuration', async () => {
    await writePackage(tempDir, {
      scripts: {
        lint: 'eslint .',
        'quality:check': 'pnpm run lint',
      },
      neo: { verify: 'quality:check' },
    });

    const result = await executeVerify(tempDir.path, { pm: 'pnpm', only: 'lint' });

    expect(result.results.map(({ script }) => script)).toEqual(['lint']);
    expect(execaMock).toHaveBeenCalledOnce();
    expect(execaMock).toHaveBeenCalledWith('pnpm', ['run', 'lint'], expect.any(Object));
  });

  it('rejects a missing --only script instead of returning partial success', async () => {
    await writePackage(tempDir, {
      scripts: { build: 'build' },
    });

    await expect(
      executeVerify(tempDir.path, { pm: 'pnpm', only: 'build,security-check' })
    ).rejects.toThrow(
      'Requested verification script "security-check" is not defined in package.json.'
    );
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('rejects a configured verification script that package.json does not define', async () => {
    await writePackage(tempDir, {
      scripts: { build: 'build' },
      neo: { verify: 'quality:check' },
    });

    await expect(executeVerify(tempDir.path, { pm: 'pnpm' })).rejects.toThrow(
      'Configured verification script "quality:check" is not defined in package.json.'
    );
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('does not treat inherited object properties as package scripts', async () => {
    await writePackage(tempDir, {
      scripts: { build: 'build' },
      neo: { verify: 'toString' },
    });

    await expect(executeVerify(tempDir.path, { pm: 'pnpm' })).rejects.toThrow(
      'Configured verification script "toString" is not defined in package.json.'
    );
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('rejects option-like configured script names before spawning', async () => {
    await writePackage(tempDir, {
      scripts: { '--help': 'echo unsafe' },
      neo: { verify: '--help' },
    });

    await expect(executeVerify(tempDir.path, { pm: 'pnpm' })).rejects.toThrow(
      'Verification script names cannot start with "-": --help.'
    );
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported package manager executables before spawning', async () => {
    await writePackage(tempDir, {
      scripts: { build: 'build' },
    });

    await expect(executeVerify(tempDir.path, { pm: 'true' })).rejects.toThrow(
      'Unsupported package manager "true". Expected one of: pnpm, npm, yarn, bun.'
    );
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('includes bounded stdout and stderr tails when a script fails', async () => {
    await writePackage(tempDir, {
      scripts: { 'quality:check': 'check' },
      neo: { verify: 'quality:check' },
    });
    const error = Object.assign(new Error('failed'), {
      exitCode: 7,
      stdout: `${'x'.repeat(9_000)}\nstdout last line`,
      stderr: `stderr first line\nstderr last line`,
    });
    execaMock.mockRejectedValueOnce(error);

    const result = await executeVerify(tempDir.path, { pm: 'pnpm' });

    expect(result.ok).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({
        script: 'quality:check',
        status: 'failed',
        exitCode: 7,
        stdoutTail: expect.stringMatching(/stdout last line$/),
        stderrTail: 'stderr first line\nstderr last line',
      }),
    ]);
    expect(result.results[0]?.stdoutTail?.length).toBeLessThanOrEqual(8_000);
  });

  it.each([
    { lockfile: 'pnpm-lock.yaml', pm: 'pnpm' },
    { lockfile: 'yarn.lock', pm: 'yarn' },
    { lockfile: 'bun.lock', pm: 'bun' },
    { lockfile: 'bun.lockb', pm: 'bun' },
    { lockfile: 'package-lock.json', pm: 'npm' },
  ])('detects $pm from $lockfile when --pm is omitted', async ({ lockfile, pm }) => {
    await writePackage(tempDir, { scripts: { build: 'build' } });
    await writeLockfile(tempDir, lockfile);

    const result = await executeVerify(tempDir.path, {});

    expect(result.packageManager).toBe(pm);
    expect(execaMock).toHaveBeenCalledWith(pm, ['run', 'build'], {
      cwd: tempDir.path,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('warns and picks the first lockfile match when several are present', async () => {
    await writePackage(tempDir, { scripts: { build: 'build' } });
    await writeLockfile(tempDir, 'package-lock.json');
    await writeLockfile(tempDir, 'pnpm-lock.yaml');

    const result = await executeVerify(tempDir.path, {});

    expect(warnMock).toHaveBeenCalledWith(
      'Multiple lockfiles detected (pnpm, npm). Using pnpm. Pass --pm to disambiguate.'
    );
    expect(result.packageManager).toBe('pnpm');
    expect(execaMock).toHaveBeenCalledWith('pnpm', ['run', 'build'], expect.any(Object));
  });

  it('does not warn when both bun lockfiles resolve to the same package manager', async () => {
    await writePackage(tempDir, { scripts: { build: 'build' } });
    await writeLockfile(tempDir, 'bun.lock');
    await writeLockfile(tempDir, 'bun.lockb');

    const result = await executeVerify(tempDir.path, {});

    expect(result.packageManager).toBe('bun');
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('rejects with VERIFY_NO_LOCKFILE when no lockfile is present', async () => {
    await writePackage(tempDir, { scripts: { build: 'build' } });

    const error = await executeVerify(tempDir.path, {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CommandError);
    expect(error).toMatchObject({
      code: 'VERIFY_NO_LOCKFILE',
      category: 'CONFIGURATION',
      message:
        'No lockfile found. Expected one of: pnpm-lock.yaml, yarn.lock, bun.lock, package-lock.json.',
      context: {
        expected: ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json'],
      },
    });
    expect(execaMock).not.toHaveBeenCalled();
  });

  it('--skip drops the named scripts from the default order', async () => {
    await writePackage(tempDir, {
      scripts: {
        build: 'build',
        test: 'test',
        lint: 'lint',
        typecheck: 'typecheck',
      },
    });

    const result = await executeVerify(tempDir.path, { pm: 'pnpm', skip: 'lint, typecheck' });

    expect(result.results.map(({ script }) => script)).toEqual(['build', 'test']);
    expect(execaMock.mock.calls.map(([, args]) => args)).toEqual([
      ['run', 'build'],
      ['run', 'test'],
    ]);
  });
});

describe('createVerifyCommand', () => {
  let tempDir: TempDir;
  let previousExitCode: typeof process.exitCode;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await createTempDir('neo-verify-command-');
    previousExitCode = process.exitCode;
    execaMock.mockResolvedValue({ stdout: '', stderr: '' } as never);
  });

  afterEach(async () => {
    process.exitCode = previousExitCode;
    setRuntimeContext(buildRuntimeContext());
    await tempDir.cleanup();
  });

  it('emits the verify payload and sets exit code 1 when a script fails', async () => {
    await writePackage(tempDir, { scripts: { build: 'build', test: 'test' } });
    await writeLockfile(tempDir, 'pnpm-lock.yaml');
    execaMock.mockResolvedValueOnce({ stdout: '', stderr: '' } as never);
    execaMock.mockRejectedValueOnce(
      Object.assign(new Error('failed'), { exitCode: 2, stdout: '', stderr: 'assertion failed' })
    );

    setRuntimeContext(buildRuntimeContext({ json: true }));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir.path);
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exitSpy = mockProcessExit();

    try {
      await createVerifyCommand().parseAsync([], { from: 'user' });

      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(stdoutWriteSpy).toHaveBeenCalledOnce();
      const payload = JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]));
      expect(payload).toMatchObject({
        ok: false,
        command: 'verify',
        packageManager: 'pnpm',
        results: [
          { script: 'build', status: 'passed' },
          { script: 'test', status: 'failed', exitCode: 2, stderrTail: 'assertion failed' },
        ],
      });
      expect(payload.error).toBeUndefined();
    } finally {
      cwdSpy.mockRestore();
      stdoutWriteSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
