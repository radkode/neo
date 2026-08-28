import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../../src/cli.ts', import.meta.url));
const TSX_IMPORT = import.meta.resolve('tsx');
const TSCONFIG_PATH = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url));
const MISSING_REF = 'neo-dd1613-missing-ref';

describe('worktree add Git failure output', () => {
  let repoPath: string;
  let worktreePath: string;

  beforeAll(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'neo-worktree-error-'));
    worktreePath = join(repoPath, 'missing-worktree');
    await execa('git', ['init', '--initial-branch=main'], { cwd: repoPath });
  });

  afterAll(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  async function runSourceCli(json = false) {
    const args = [
      '--import',
      TSX_IMPORT,
      CLI_PATH,
      '--no-banner',
      '--no-color',
      '--quiet',
      '--non-interactive',
    ];
    if (json) args.push('--json');
    args.push('git', 'worktree', 'add', MISSING_REF, '--detach', '--path', worktreePath);
    return execa(process.execPath, args, {
      cwd: repoPath,
      env: { TSX_TSCONFIG_PATH: TSCONFIG_PATH },
      reject: false,
    });
  }

  it('shows the failed Git command and stderr in text mode', async () => {
    const result = await runSourceCli();

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Git command failed: worktree add');
    expect(result.stderr).toContain('Command: git worktree add --detach');
    expect(result.stderr).toContain(`fatal: invalid reference: ${MISSING_REF}`);
    await expect(access(worktreePath)).rejects.toThrow();
  });

  it('emits the same failure as one structured JSON object', async () => {
    const result = await runSourceCli(true);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.error.code).toBe('GIT_UNKNOWN_ERROR');
    expect(payload.error.message).toBe('Git command failed: worktree add');
    expect(payload.error.context.command).toContain('git worktree add --detach');
    expect(payload.error.context.exitCode).toBe(128);
    expect(payload.error.context.stderr).toBe(`fatal: invalid reference: ${MISSING_REF}`);
    expect(payload.error.context.error).toBe(`fatal: invalid reference: ${MISSING_REF}`);
    await expect(access(worktreePath)).rejects.toThrow();
  });
});
