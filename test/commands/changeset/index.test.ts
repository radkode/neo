import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  createPromptsMock,
  createTempDir,
  createUiMock,
  mockProcessExit,
  type TempDir,
} from '../../utils/test-helpers.js';

vi.mock('@/utils/ui.js', () => ({ ui: createUiMock() }));

vi.mock('@inquirer/prompts', () =>
  createPromptsMock({ checkbox: ['pkg-a'], input: '  prompted summary  ' })
);

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return { ...actual, access: vi.fn(actual.access) };
});

import { checkbox, input, select } from '@inquirer/prompts';
import { createChangesetCommand, executeChangeset } from '@/commands/changeset/index.js';
import { CommandError, ErrorCategory } from '@/core/errors/index.js';
import { NonInteractiveError } from '@/utils/prompt.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { ui } from '@/utils/ui.js';

interface CheckboxConfig {
  message: string;
  choices: Array<{ name: string; value: string }>;
  validate: (selected: readonly unknown[]) => boolean | string;
}

interface InputConfig {
  message: string;
  validate: (value: string) => boolean | string;
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, JSON.stringify(value));
}

async function initChangesets(dir: string): Promise<void> {
  await writeText(join(dir, '.changeset', 'config.json'), '{}');
}

async function singlePackageRepo(
  dir: string,
  pkg: Record<string, unknown> = { name: 'neo' }
): Promise<void> {
  await initChangesets(dir);
  await writeJson(join(dir, 'package.json'), pkg);
}

async function pnpmWorkspaceRepo(
  dir: string,
  yaml = "packages:\n  - 'packages/*'\n"
): Promise<void> {
  await initChangesets(dir);
  await writeJson(join(dir, 'package.json'), { name: 'root', private: true });
  await writeText(join(dir, 'pnpm-workspace.yaml'), yaml);
}

async function captureError<E extends Error>(run: () => Promise<unknown>): Promise<E> {
  try {
    await run();
  } catch (error) {
    return error as E;
  }
  throw new Error('Expected the call to reject, but it resolved.');
}

function denyNextAccess(): void {
  vi.mocked(access).mockImplementationOnce(() =>
    Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))
  );
}

describe('executeChangeset', () => {
  let tempDir: TempDir;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await createTempDir('neo-changeset-test-');
    setRuntimeContext(buildRuntimeContext());
  });

  afterEach(async () => {
    setRuntimeContext(buildRuntimeContext());
    await tempDir.cleanup();
  });

  describe('changesets configuration', () => {
    it('rejects a repository without .changeset/config.json', async () => {
      await writeJson(join(tempDir.path, 'package.json'), { name: 'neo' });

      const error = await captureError<CommandError>(() =>
        executeChangeset(tempDir.path, { bump: 'patch', summary: 'fix x' })
      );

      expect(error).toBeInstanceOf(CommandError);
      expect(error.code).toBe('CHANGESET_NO_CONFIG');
      expect(error.category).toBe(ErrorCategory.CONFIGURATION);
      expect(error.message).toBe('No .changeset/config.json found.');
      expect(error.context).toMatchObject({
        configPath: join(tempDir.path, '.changeset', 'config.json'),
      });
      expect(error.suggestions).toContain('Initialize changesets: pnpm dlx @changesets/cli init');
    });

    it('reports an unreadable .changeset path instead of treating it as absent', async () => {
      await singlePackageRepo(tempDir.path);
      denyNextAccess();

      const error = await captureError<CommandError>(() =>
        executeChangeset(tempDir.path, { bump: 'patch', summary: 'fix x' })
      );

      expect(error).toBeInstanceOf(CommandError);
      expect(error.code).toBe('CHANGESET_PATH_UNREADABLE');
      expect(error.category).toBe(ErrorCategory.FILESYSTEM);
      expect(error.message).toBe(
        `Cannot access ${join(tempDir.path, '.changeset', 'config.json')}: EACCES: permission denied`
      );
      expect(error.context).toMatchObject({
        errno: 'EACCES',
        path: join(tempDir.path, '.changeset', 'config.json'),
      });
    });

    it('treats a non-directory .changeset path as an absent config', async () => {
      await writeText(join(tempDir.path, '.changeset'), 'not a directory');

      const error = await captureError<CommandError>(() =>
        executeChangeset(tempDir.path, { bump: 'patch', summary: 'fix x' })
      );

      expect(error.code).toBe('CHANGESET_NO_CONFIG');
    });
  });

  describe('bump parsing', () => {
    it('rejects a bump level outside the supported set', async () => {
      await singlePackageRepo(tempDir.path);

      const error = await captureError<CommandError>(() =>
        executeChangeset(tempDir.path, { bump: 'nope', summary: 'fix x' })
      );

      expect(error).toBeInstanceOf(CommandError);
      expect(error.code).toBe('CHANGESET_INVALID_BUMP');
      expect(error.category).toBe(ErrorCategory.VALIDATION);
      expect(error.message).toBe(
        'Invalid --bump "nope". Expected one of: major, minor, patch, empty.'
      );
      expect(error.context).toMatchObject({ bump: 'nope' });
    });

    it('trims and lowercases the bump level', async () => {
      await singlePackageRepo(tempDir.path);

      const result = await executeChangeset(tempDir.path, {
        bump: '  MINOR  ',
        summary: 'add thing',
      });

      expect(result.bump).toBe('minor');
      await expect(readFile(result.path, 'utf-8')).resolves.toBe(
        "---\n'neo': minor\n---\n\nadd thing\n"
      );
    });

    it('accepts the patch default under --yes rather than prompting', async () => {
      await singlePackageRepo(tempDir.path);
      setRuntimeContext(buildRuntimeContext({ yes: true }));

      const result = await executeChangeset(tempDir.path, { summary: 'fix x' });

      expect(result.bump).toBe('patch');
      expect(select).not.toHaveBeenCalled();
      await expect(readFile(result.path, 'utf-8')).resolves.toBe(
        "---\n'neo': patch\n---\n\nfix x\n"
      );
    });

    it('names --bump as the flag to pass when the bump prompt cannot run', async () => {
      await singlePackageRepo(tempDir.path);
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

      const error = await captureError<NonInteractiveError>(() =>
        executeChangeset(tempDir.path, { summary: 'fix x' })
      );

      expect(error).toBeInstanceOf(NonInteractiveError);
      expect(error.prompt).toBe('What kind of change is this?');
      expect(error.flag).toBe('--bump');
    });
  });

  describe('single-package repositories', () => {
    it('writes the changeset body and returns where it landed', async () => {
      await singlePackageRepo(tempDir.path);

      const result = await executeChangeset(tempDir.path, { bump: 'patch', summary: '  fix x  ' });

      expect(result).toEqual({
        path: expect.any(String),
        bump: 'patch',
        packages: ['neo'],
        summary: 'fix x',
      });
      expect(result.path).toMatch(/\.changeset\/[a-z]+-[a-z]+-[a-z]+\.md$/);
      await expect(readFile(result.path, 'utf-8')).resolves.toBe(
        "---\n'neo': patch\n---\n\nfix x\n"
      );
    });

    it('falls back to a timestamped name when the generated names collide', async () => {
      await singlePackageRepo(tempDir.path);
      await writeText(join(tempDir.path, '.changeset', 'brisk-ants-bake.md'), 'taken');
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

      try {
        const result = await executeChangeset(tempDir.path, { bump: 'patch', summary: 'fix x' });

        expect(result.path).toMatch(/\.changeset\/neo-\d+\.md$/);
        await expect(
          readFile(join(tempDir.path, '.changeset', 'brisk-ants-bake.md'), 'utf-8')
        ).resolves.toBe('taken');
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('keeps a private root package as the bump target', async () => {
      await singlePackageRepo(tempDir.path, { name: 'neo', private: true });

      const result = await executeChangeset(tempDir.path, { bump: 'major', summary: 'break it' });

      expect(result.packages).toEqual(['neo']);
      await expect(readFile(result.path, 'utf-8')).resolves.toBe(
        "---\n'neo': major\n---\n\nbreak it\n"
      );
    });

    it('rejects a root package.json without a name', async () => {
      await singlePackageRepo(tempDir.path, { version: '1.0.0' });

      const error = await captureError<CommandError>(() =>
        executeChangeset(tempDir.path, { bump: 'patch', summary: 'fix x' })
      );

      expect(error.code).toBe('CHANGESET_ROOT_NAME_MISSING');
      expect(error.category).toBe(ErrorCategory.CONFIGURATION);
      expect(error.message).toBe('Root package.json is missing a "name" field.');
    });
  });

  describe('empty changesets', () => {
    it('writes the empty form without discovering packages or asking for a summary', async () => {
      await initChangesets(tempDir.path);

      const result = await executeChangeset(tempDir.path, { bump: 'empty' });

      expect(result.packages).toEqual([]);
      expect(result.summary).toBe('');
      await expect(readFile(result.path, 'utf-8')).resolves.toBe('---\n---\n');
      expect(checkbox).not.toHaveBeenCalled();
      expect(input).not.toHaveBeenCalled();
    });
  });

  describe('workspace discovery', () => {
    it('excludes private workspace packages', async () => {
      await pnpmWorkspaceRepo(tempDir.path);
      await writeJson(join(tempDir.path, 'packages', 'a', 'package.json'), { name: 'pkg-a' });
      await writeJson(join(tempDir.path, 'packages', 'b', 'package.json'), {
        name: 'pkg-b',
        private: true,
      });

      const error = await captureError<CommandError>(() =>
        executeChangeset(tempDir.path, { bump: 'minor', package: 'pkg-b', summary: 's' })
      );

      expect(error.code).toBe('CHANGESET_UNKNOWN_PACKAGE');
      expect(error.category).toBe(ErrorCategory.VALIDATION);
      expect(error.message).toBe('Unknown package(s): pkg-b. Known: pkg-a.');
    });

    it('writes one entry per requested package', async () => {
      await pnpmWorkspaceRepo(tempDir.path);
      await writeJson(join(tempDir.path, 'packages', 'a', 'package.json'), { name: 'pkg-a' });
      await writeJson(join(tempDir.path, 'packages', 'b', 'package.json'), { name: 'pkg-b' });

      const result = await executeChangeset(tempDir.path, {
        bump: 'minor',
        package: ' pkg-a , pkg-b ',
        summary: 'two packages',
      });

      expect(result.packages).toEqual(['pkg-a', 'pkg-b']);
      await expect(readFile(result.path, 'utf-8')).resolves.toBe(
        "---\n'pkg-a': minor\n'pkg-b': minor\n---\n\ntwo packages\n"
      );
    });

    it('stops reading pnpm-workspace.yaml at the next top-level key', async () => {
      await pnpmWorkspaceRepo(
        tempDir.path,
        "packages:\n  - 'packages/*'\n\ncatalog:\n  - 'tools'\n"
      );
      await writeJson(join(tempDir.path, 'packages', 'a', 'package.json'), { name: 'pkg-a' });
      await writeJson(join(tempDir.path, 'tools', 'package.json'), { name: 'tools-pkg' });

      const error = await captureError<CommandError>(() =>
        executeChangeset(tempDir.path, { bump: 'patch', package: 'tools-pkg', summary: 's' })
      );

      expect(error.code).toBe('CHANGESET_UNKNOWN_PACKAGE');
      expect(error.message).toBe('Unknown package(s): tools-pkg. Known: pkg-a.');
    });

    it('expands globs and bare directories from workspaces, skipping missing ones', async () => {
      await initChangesets(tempDir.path);
      await writeJson(join(tempDir.path, 'package.json'), {
        name: 'root',
        private: true,
        workspaces: ['packages/*', 'tools', 'missing/*'],
      });
      await writeJson(join(tempDir.path, 'packages', 'a', 'package.json'), { name: 'pkg-a' });
      await writeJson(join(tempDir.path, 'tools', 'package.json'), { name: 'tools-pkg' });

      const result = await executeChangeset(tempDir.path, {
        bump: 'patch',
        package: 'pkg-a,tools-pkg',
        summary: 's',
      });

      expect(result.packages).toEqual(['pkg-a', 'tools-pkg']);
      await expect(readFile(result.path, 'utf-8')).resolves.toBe(
        "---\n'pkg-a': patch\n'tools-pkg': patch\n---\n\ns\n"
      );
    });

    it('reads the workspaces.packages object form', async () => {
      await initChangesets(tempDir.path);
      await writeJson(join(tempDir.path, 'package.json'), {
        name: 'root',
        private: true,
        workspaces: { packages: ['packages/*'] },
      });
      await writeJson(join(tempDir.path, 'packages', 'a', 'package.json'), { name: 'pkg-a' });

      const result = await executeChangeset(tempDir.path, { bump: 'patch', summary: 's' });

      expect(result.packages).toEqual(['pkg-a']);
    });

    it('warns and continues when a workspace package.json cannot be parsed', async () => {
      await pnpmWorkspaceRepo(tempDir.path);
      await writeJson(join(tempDir.path, 'packages', 'a', 'package.json'), { name: 'pkg-a' });
      await writeText(join(tempDir.path, 'packages', 'broken', 'package.json'), '{ "name": ');

      const result = await executeChangeset(tempDir.path, { bump: 'patch', summary: 's' });

      expect(result.packages).toEqual(['pkg-a']);
      expect(ui.warn).toHaveBeenCalledTimes(1);
      expect(ui.warn).toHaveBeenCalledWith(
        expect.stringContaining(join(tempDir.path, 'packages', 'broken', 'package.json'))
      );
      expect(vi.mocked(ui.warn).mock.calls[0]?.[0]).toMatch(/^Skipping /);
    });

    it('rejects a workspace where every package is private', async () => {
      await pnpmWorkspaceRepo(tempDir.path);
      await writeJson(join(tempDir.path, 'packages', 'a', 'package.json'), {
        name: 'pkg-a',
        private: true,
      });

      const error = await captureError<CommandError>(() =>
        executeChangeset(tempDir.path, { bump: 'patch', summary: 's' })
      );

      expect(error.code).toBe('CHANGESET_NO_PACKAGES');
      expect(error.category).toBe(ErrorCategory.CONFIGURATION);
      expect(error.message).toBe('No publishable packages found in workspaces.');
      expect(error.context).toMatchObject({ workspacePatterns: ['packages/*'] });
    });
  });

  describe('package selection', () => {
    beforeEach(async () => {
      await pnpmWorkspaceRepo(tempDir.path);
      await writeJson(join(tempDir.path, 'packages', 'a', 'package.json'), { name: 'pkg-a' });
      await writeJson(join(tempDir.path, 'packages', 'b', 'package.json'), { name: 'pkg-b' });
    });

    it('prompts with the discovered packages when more than one is publishable', async () => {
      const result = await executeChangeset(tempDir.path, { bump: 'minor', summary: 's' });

      expect(result.packages).toEqual(['pkg-a']);
      const config = vi.mocked(checkbox).mock.calls[0]?.[0] as unknown as CheckboxConfig;
      expect(config.message).toBe('Which packages are affected?');
      expect(config.choices).toHaveLength(2);
      expect(config.choices).toEqual(
        expect.arrayContaining([
          { name: 'pkg-a', value: 'pkg-a' },
          { name: 'pkg-b', value: 'pkg-b' },
        ])
      );
      expect(config.validate([])).toBe('Pick at least one package.');
      expect(config.validate([{ value: 'pkg-a' }])).toBe(true);
    });

    it('refuses to guess the packages in non-interactive mode', async () => {
      setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));

      const error = await captureError<NonInteractiveError>(() =>
        executeChangeset(tempDir.path, { bump: 'minor', summary: 's' })
      );

      expect(error).toBeInstanceOf(NonInteractiveError);
      expect(error.prompt).toBe('Select package(s) to bump');
      expect(error.flag).toBe('--package <name>[,<name>...]');
      expect(checkbox).not.toHaveBeenCalled();
    });
  });

  describe('summary', () => {
    it('prompts for a summary and trims the answer', async () => {
      await singlePackageRepo(tempDir.path);

      const result = await executeChangeset(tempDir.path, { bump: 'patch' });

      expect(result.summary).toBe('prompted summary');
      await expect(readFile(result.path, 'utf-8')).resolves.toBe(
        "---\n'neo': patch\n---\n\nprompted summary\n"
      );
      const config = vi.mocked(input).mock.calls[0]?.[0] as unknown as InputConfig;
      expect(config.message).toBe('One-line summary (shown in the changelog):');
      expect(config.validate('   ')).toBe('Summary cannot be empty.');
      expect(config.validate('real summary')).toBe(true);
    });

    it('refuses to invent a summary under --yes', async () => {
      await singlePackageRepo(tempDir.path);
      setRuntimeContext(buildRuntimeContext({ yes: true }));

      const error = await captureError<NonInteractiveError>(() =>
        executeChangeset(tempDir.path, { bump: 'patch' })
      );

      expect(error).toBeInstanceOf(NonInteractiveError);
      expect(error.prompt).toBe('Changeset summary');
      expect(error.flag).toBe('--summary "<text>"');
      expect(input).not.toHaveBeenCalled();
    });
  });
});

describe('createChangesetCommand', () => {
  let tempDir: TempDir;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await createTempDir('neo-changeset-cmd-');
    setRuntimeContext(buildRuntimeContext());
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir.path);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = mockProcessExit();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
    setRuntimeContext(buildRuntimeContext());
    await tempDir.cleanup();
  });

  it('exposes the bump, summary and package options', () => {
    const command = createChangesetCommand();

    expect(command.name()).toBe('changeset');
    expect(command.description()).toBe(
      'Create a changeset file (bump type + summary) under .changeset/'
    );
    expect(command.options.map(({ flags }) => flags)).toEqual([
      '--bump <level>',
      '--summary <text>',
      '--package <names>',
    ]);
  });

  it('emits the changeset payload in json mode', async () => {
    await singlePackageRepo(tempDir.path);
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createChangesetCommand().parseAsync(['--bump', 'patch', '--summary', 'fix x'], {
      from: 'user',
    });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(stdoutSpy.mock.calls[0]?.[0]));
    expect(payload).toEqual({
      ok: true,
      command: 'changeset',
      path: expect.stringMatching(/\.changeset\/[a-z]+-[a-z]+-[a-z]+\.md$/),
      bump: 'patch',
      packages: ['neo'],
      summary: 'fix x',
    });
    await expect(readFile(String(payload.path), 'utf-8')).resolves.toBe(
      "---\n'neo': patch\n---\n\nfix x\n"
    );
  });

  it('reports the written file in text mode', async () => {
    await singlePackageRepo(tempDir.path);

    await createChangesetCommand().parseAsync(['--bump', 'minor', '--summary', 'add x'], {
      from: 'user',
    });

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(ui.success).toHaveBeenCalledWith(expect.stringMatching(/^Wrote .*\.changeset\/.*\.md$/));
    expect(ui.muted).toHaveBeenCalledWith('minor bump for neo');
  });

  it('reports an empty changeset as carrying no version bump', async () => {
    await initChangesets(tempDir.path);

    await createChangesetCommand().parseAsync(['--bump', 'empty'], { from: 'user' });

    expect(ui.success).toHaveBeenCalledWith(expect.stringMatching(/^Wrote .*\.changeset\/.*\.md$/));
    expect(ui.muted).toHaveBeenCalledWith(expect.stringContaining('Empty changeset'));
  });

  it('exits 1 with a serialized error when the bump level is invalid', async () => {
    await singlePackageRepo(tempDir.path);
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createChangesetCommand().parseAsync(['--bump', 'nope'], { from: 'user' });

    expect(exitSpy).toHaveBeenCalledWith(1);
    const payload = JSON.parse(String(stdoutSpy.mock.calls[0]?.[0]));
    expect(payload.error).toMatchObject({
      code: 'CHANGESET_INVALID_BUMP',
      category: 'VALIDATION',
      severity: 'medium',
      message: 'Invalid --bump "nope". Expected one of: major, minor, patch, empty.',
    });
  });

  it('exits 2 when package selection would need a prompt', async () => {
    await pnpmWorkspaceRepo(tempDir.path);
    await writeJson(join(tempDir.path, 'packages', 'a', 'package.json'), { name: 'pkg-a' });
    await writeJson(join(tempDir.path, 'packages', 'b', 'package.json'), { name: 'pkg-b' });
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createChangesetCommand().parseAsync(['--bump', 'minor', '--summary', 's'], {
      from: 'user',
    });

    expect(exitSpy).toHaveBeenNthCalledWith(1, 2);
    const payload = JSON.parse(String(stdoutSpy.mock.calls[0]?.[0]));
    expect(payload.error).toMatchObject({
      code: 'NEO_NON_INTERACTIVE',
      prompt: 'Select package(s) to bump',
      flag: '--package <name>[,<name>...]',
    });
  });
});
