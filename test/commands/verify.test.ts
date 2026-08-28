import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import { executeVerify } from '@/commands/verify/index.js';
import { createTempDir, type TempDir } from '../utils/test-helpers.js';

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

const execaMock = vi.mocked(execa);

async function writePackage(tempDir: TempDir, manifest: Record<string, unknown>): Promise<void> {
  await writeFile(`${tempDir.path}/package.json`, JSON.stringify(manifest));
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
});
