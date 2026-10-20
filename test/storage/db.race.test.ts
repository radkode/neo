import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, open, readFile, rm, writeFile } from 'fs/promises';
import { lstatSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ContextDB } from '../../src/storage/db.js';

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

describe('ContextDB inspection race', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('does not treat a file removed between inspection and open as empty', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'neo-context-race-'));
    const dbPath = join(tempDir, 'contexts.json');
    await writeFile(dbPath, '{"version":1,"contexts":[]}');
    const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      await rm(dbPath);
      return actual.open(...args);
    });

    await expect(ContextDB.create(dbPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('replaces a symlink planted after the final file check without following it', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'neo-context-race-'));
    const dbPath = join(tempDir, 'contexts.json');
    const sentinel = join(tempDir, 'outside.txt');
    await writeFile(sentinel, 'untouched');
    const db = await ContextDB.create(dbPath);
    const actual = await vi.importActual<typeof import('fs')>('fs');
    vi.mocked(renameSync).mockImplementationOnce((source, destination) => {
      actual.symlinkSync(sentinel, dbPath);
      actual.renameSync(source, destination);
    });

    db.addContext({ content: 'saved' });

    expect(await readFile(sentinel, 'utf-8')).toBe('untouched');
    expect(lstatSync(dbPath).isFile()).toBe(true);
    expect((await ContextDB.create(dbPath)).listContexts()[0]?.content).toBe('saved');
  });
});
