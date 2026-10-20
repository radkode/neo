import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execa } from 'execa';
import {
  createAgentDir,
  getAgentDbPath,
  getAgentDir,
  getProjectRoot,
} from '../../src/utils/agent.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

describe('agent path safety', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'neo-agent-path-'));
    outside = await mkdtemp(join(tmpdir(), 'neo-agent-outside-'));
    await mkdir(join(root, '.neo'));
    vi.mocked(execa).mockResolvedValue({ stdout: `${join(root, '.git')}\n${root}` } as never);
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('uses only the Git root even when a nested .neo exists', async () => {
    await mkdir(join(root, 'nested', '.neo'), { recursive: true });

    expect(await getProjectRoot()).toBe(root);
    expect(await getAgentDbPath()).toBe(join(root, '.neo', 'agent', 'contexts.json'));
    expect(execa).toHaveBeenCalledWith('git', [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
      '--show-toplevel',
    ]);
  });

  it('uses the primary checkout when called from a linked worktree', async () => {
    const worktree = join(root, '.worktrees', 'caller');
    await mkdir(join(worktree, '.neo'), { recursive: true });
    vi.mocked(execa).mockResolvedValue({ stdout: `${join(root, '.git')}\n${worktree}` } as never);

    expect(await getProjectRoot()).toBe(root);
    expect(await getAgentDbPath()).toBe(join(root, '.neo', 'agent', 'contexts.json'));
  });

  it('rejects a symlinked .neo directory', async () => {
    await rm(join(root, '.neo'), { recursive: true });
    await symlink(outside, join(root, '.neo'), 'dir');
    await writeFile(join(outside, 'sentinel'), 'untouched');

    await expect(getProjectRoot()).rejects.toThrow();
    await expect(createAgentDir()).rejects.toThrow();
    expect(await readFile(join(outside, 'sentinel'), 'utf-8')).toBe('untouched');
  });

  it('rejects a symlinked agent directory', async () => {
    await symlink(outside, join(root, '.neo', 'agent'), 'dir');
    await writeFile(join(outside, 'sentinel'), 'untouched');

    await expect(getAgentDir()).rejects.toThrow();
    await expect(createAgentDir()).rejects.toThrow();
    expect(await readFile(join(outside, 'sentinel'), 'utf-8')).toBe('untouched');
  });

  it('rejects a symlinked context file', async () => {
    await mkdir(join(root, '.neo', 'agent'));
    const sentinel = join(outside, 'sentinel');
    await writeFile(sentinel, '{"version":1,"contexts":[]}');
    await symlink(sentinel, join(root, '.neo', 'agent', 'contexts.json'));

    await expect(getAgentDbPath()).rejects.toThrow();
    expect(await readFile(sentinel, 'utf-8')).toBe('{"version":1,"contexts":[]}');
  });

  it('creates and returns the root-bound agent directory', async () => {
    expect(await createAgentDir()).toBe(join(root, '.neo', 'agent'));
    expect(await getAgentDbPath()).toBe(join(root, '.neo', 'agent', 'contexts.json'));
  });
});
