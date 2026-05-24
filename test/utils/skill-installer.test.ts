import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { installClaudeSkill } from '@/utils/skill-installer.js';

describe('installClaudeSkill', () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let bundledTemplatePath: string;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'neo-skill-test-'));
    // os.homedir() honors $HOME on POSIX — overriding it lets us run the
    // installer against a sandbox without touching the real home dir.
    originalHome = process.env['HOME'];
    process.env['HOME'] = tmpHome;

    bundledTemplatePath = join(
      process.cwd(),
      'templates',
      'skills',
      'neo',
      'SKILL.md'
    );
    await stat(bundledTemplatePath); // throws if missing
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('returns null when ~/.claude does not exist', async () => {
    const result = await installClaudeSkill();
    expect(result).toBeNull();
  });

  it('installs the skill when ~/.claude exists but skill is missing', async () => {
    await mkdir(join(tmpHome, '.claude'), { recursive: true });

    const result = await installClaudeSkill();

    expect(result).not.toBeNull();
    expect(result!.status).toBe('installed');
    expect(result!.destination).toBe(
      join(tmpHome, '.claude', 'skills', 'neo', 'SKILL.md')
    );

    const dest = await readFile(result!.destination, 'utf8');
    const src = await readFile(bundledTemplatePath, 'utf8');
    expect(dest).toBe(src);
  });

  it('reports unchanged when destination already matches', async () => {
    await mkdir(join(tmpHome, '.claude', 'skills', 'neo'), { recursive: true });
    const src = await readFile(bundledTemplatePath);
    await writeFile(
      join(tmpHome, '.claude', 'skills', 'neo', 'SKILL.md'),
      src
    );

    const result = await installClaudeSkill();
    expect(result!.status).toBe('unchanged');
  });

  it('skips when destination diverges and force is not set', async () => {
    await mkdir(join(tmpHome, '.claude', 'skills', 'neo'), { recursive: true });
    await writeFile(
      join(tmpHome, '.claude', 'skills', 'neo', 'SKILL.md'),
      'custom user content'
    );

    const result = await installClaudeSkill();
    expect(result!.status).toBe('skipped-divergent');

    const after = await readFile(
      join(tmpHome, '.claude', 'skills', 'neo', 'SKILL.md'),
      'utf8'
    );
    expect(after).toBe('custom user content');
  });

  it('overwrites a divergent destination when force is set', async () => {
    await mkdir(join(tmpHome, '.claude', 'skills', 'neo'), { recursive: true });
    await writeFile(
      join(tmpHome, '.claude', 'skills', 'neo', 'SKILL.md'),
      'custom user content'
    );

    const result = await installClaudeSkill({ force: true });
    expect(result!.status).toBe('updated');

    const dest = await readFile(result!.destination, 'utf8');
    const src = await readFile(bundledTemplatePath, 'utf8');
    expect(dest).toBe(src);
  });
});
