import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProfileCommand } from '@/commands/config/profile/index.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';
import { captureConsole, mockProcessExit, type ConsoleMocks } from '../../utils/test-helpers.js';

vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    highlight: vi.fn(),
    info: vi.fn(),
    keyValue: vi.fn(),
    list: vi.fn(),
    muted: vi.fn(),
    section: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/utils/profiles.js', () => ({
  profileManager: {
    copy: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    export: vi.fn(),
    getActive: vi.fn(),
    getProfilesDir: vi.fn(),
    import: vi.fn(),
    initialize: vi.fn(),
    list: vi.fn(),
    read: vi.fn(),
    setActive: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({ writeFile: vi.fn() }));

vi.mock('@/utils/validation.js', () => ({
  validate: vi.fn((_schema, value) => value),
  validateArgument: vi.fn((_schema, value) => value),
  isValidationError: vi.fn().mockReturnValue(false),
}));

import { writeFile } from 'fs/promises';
import { ui } from '@/utils/ui.js';
import { profileManager, type ProfileConfig } from '@/utils/profiles.js';

const profileConfig: ProfileConfig = {
  ai: { enabled: true, model: 'claude-haiku-4-5-20251001' },
  preferences: { aliases: { n: true }, banner: 'full', editor: 'vim', theme: 'auto' },
  shell: { rcFile: '/home/u/.zshrc', type: 'zsh' },
  user: { email: 'dev@example.com', name: 'Dev' },
};

const exportedJson = JSON.stringify(profileConfig, null, 2);

describe('createProfileCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let consoleMocks: ConsoleMocks;

  const jsonPayload = () => JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]));

  beforeEach(() => {
    vi.clearAllMocks();
    setRuntimeContext(buildRuntimeContext({ json: true }));
    exitMock = mockProcessExit();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    consoleMocks = captureConsole();
    vi.mocked(profileManager.getProfilesDir).mockReturnValue('/home/u/.config/neo/profiles');
    vi.mocked(profileManager.getActive).mockResolvedValue('work');
  });

  afterEach(() => {
    consoleMocks.restore();
    stdoutWriteSpy.mockRestore();
    exitMock.mockRestore();
    setRuntimeContext(buildRuntimeContext());
  });

  describe('command structure', () => {
    it('registers the seven profile subcommands in order', () => {
      const command = createProfileCommand();

      expect(command.name()).toBe('profile');
      expect(command.description()).toBe('Manage configuration profiles');
      expect(command.commands.map((c) => c.name())).toEqual([
        'list',
        'create',
        'use',
        'delete',
        'show',
        'export',
        'import',
      ]);
    });
  });

  describe('profile list', () => {
    it('emits the profiles, active name and profiles directory', async () => {
      vi.mocked(profileManager.list).mockResolvedValue(['default', 'work']);

      await createProfileCommand().parseAsync(['list'], { from: 'user' });

      expect(profileManager.initialize).toHaveBeenCalled();
      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      expect(jsonPayload()).toEqual({
        ok: true,
        command: 'config.profile.list',
        profiles: ['default', 'work'],
        active: 'work',
        profilesDir: '/home/u/.config/neo/profiles',
      });
    });

    it('marks the active profile in text mode', async () => {
      setRuntimeContext(buildRuntimeContext());
      vi.mocked(profileManager.list).mockResolvedValue(['default', 'work']);

      await createProfileCommand().parseAsync(['list'], { from: 'user' });

      expect(ui.info).toHaveBeenCalledWith('Configuration Profiles:');
      expect(ui.highlight).toHaveBeenCalledWith('  work (active)');
      expect(ui.muted).toHaveBeenCalledWith('  default');
      expect(ui.muted).toHaveBeenCalledWith('Profiles directory: /home/u/.config/neo/profiles');
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });

    it('reports an empty profile list in text mode', async () => {
      setRuntimeContext(buildRuntimeContext());
      vi.mocked(profileManager.list).mockResolvedValue([]);

      await createProfileCommand().parseAsync(['list'], { from: 'user' });

      expect(ui.info).toHaveBeenCalledWith('No profiles found');
      expect(ui.highlight).not.toHaveBeenCalled();
      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });
  });

  describe('profile create', () => {
    it('creates a fresh profile and reports no source', async () => {
      await createProfileCommand().parseAsync(['create', 'work'], { from: 'user' });

      expect(profileManager.create).toHaveBeenCalledWith('work');
      expect(profileManager.copy).not.toHaveBeenCalled();
      expect(jsonPayload()).toEqual({
        ok: true,
        command: 'config.profile.create',
        name: 'work',
        copiedFrom: null,
      });
    });

    it('copies from the base profile with --from instead of creating', async () => {
      await createProfileCommand().parseAsync(['create', 'work', '--from', 'base'], {
        from: 'user',
      });

      expect(profileManager.copy).toHaveBeenCalledWith('base', 'work');
      expect(profileManager.create).not.toHaveBeenCalled();
      expect(jsonPayload()).toEqual({
        ok: true,
        command: 'config.profile.create',
        name: 'work',
        copiedFrom: 'base',
      });
    });

    it('names the source profile in the text confirmation', async () => {
      setRuntimeContext(buildRuntimeContext());

      await createProfileCommand().parseAsync(['create', 'work', '-f', 'base'], { from: 'user' });

      expect(ui.success).toHaveBeenCalledWith("Created profile 'work' (copied from 'base')");
      expect(ui.muted).toHaveBeenCalledWith(
        "Use 'neo config profile use work' to switch to this profile"
      );
    });
  });

  describe('profile use', () => {
    it('activates the profile and echoes the new active name', async () => {
      await createProfileCommand().parseAsync(['use', 'work'], { from: 'user' });

      expect(profileManager.setActive).toHaveBeenCalledWith('work');
      expect(jsonPayload()).toEqual({
        ok: true,
        command: 'config.profile.use',
        active: 'work',
      });
    });

    it('exits 1 with the manager error when activation fails', async () => {
      vi.mocked(profileManager.setActive).mockRejectedValue(
        new Error("Profile 'work' does not exist")
      );

      await createProfileCommand().parseAsync(['use', 'work'], { from: 'user' });

      expect(jsonPayload()).toMatchObject({
        error: { message: "Profile 'work' does not exist" },
      });
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('profile delete', () => {
    it('deletes the named profile', async () => {
      await createProfileCommand().parseAsync(['delete', 'work'], { from: 'user' });

      expect(profileManager.delete).toHaveBeenCalledWith('work');
      expect(jsonPayload()).toEqual({
        ok: true,
        command: 'config.profile.delete',
        name: 'work',
      });
    });
  });

  describe('profile show', () => {
    it('falls back to the active profile when no name is given', async () => {
      vi.mocked(profileManager.read).mockResolvedValue(profileConfig);

      await createProfileCommand().parseAsync(['show'], { from: 'user' });

      expect(profileManager.read).toHaveBeenCalledWith('work');
      expect(jsonPayload()).toEqual({
        ok: true,
        command: 'config.profile.show',
        name: 'work',
        active: true,
        config: profileConfig,
      });
    });

    it('reports active:false for a profile other than the active one', async () => {
      vi.mocked(profileManager.read).mockResolvedValue(profileConfig);

      await createProfileCommand().parseAsync(['show', 'personal'], { from: 'user' });

      expect(profileManager.read).toHaveBeenCalledWith('personal');
      expect(jsonPayload()).toMatchObject({
        name: 'personal',
        active: false,
      });
    });

    it('renders the config sections in text mode', async () => {
      setRuntimeContext(buildRuntimeContext());
      vi.mocked(profileManager.read).mockResolvedValue(profileConfig);

      await createProfileCommand().parseAsync(['show'], { from: 'user' });

      expect(ui.info).toHaveBeenCalledWith('Profile: work (active)');
      expect(ui.section).toHaveBeenCalledWith('AI');
      expect(ui.section).toHaveBeenCalledWith('User');
      expect(ui.section).toHaveBeenCalledWith('Preferences');
      expect(ui.section).toHaveBeenCalledWith('Shell');
      expect(ui.keyValue).toHaveBeenCalledWith([
        ['enabled', 'yes'],
        ['model', 'claude-haiku-4-5-20251001'],
      ]);
      expect(ui.keyValue).toHaveBeenCalledWith([
        ['banner', 'full'],
        ['theme', 'auto'],
        ['editor', 'vim'],
        ['aliases.n', 'enabled'],
      ]);
    });

    it('omits the user section when the profile has no user details', async () => {
      setRuntimeContext(buildRuntimeContext());
      vi.mocked(profileManager.read).mockResolvedValue({ ...profileConfig, user: {} });

      await createProfileCommand().parseAsync(['show'], { from: 'user' });

      expect(ui.section).toHaveBeenCalledWith('AI');
      expect(ui.section).not.toHaveBeenCalledWith('User');
    });
  });

  describe('profile export', () => {
    beforeEach(() => {
      vi.mocked(profileManager.export).mockResolvedValue(exportedJson);
    });

    it('writes the export to --output and confirms the destination', async () => {
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await createProfileCommand().parseAsync(['export', 'work', '--output', '/tmp/p.json'], {
        from: 'user',
      });

      expect(profileManager.export).toHaveBeenCalledWith('work');
      expect(writeFile).toHaveBeenCalledWith('/tmp/p.json', exportedJson, 'utf-8');
      expect(jsonPayload()).toEqual({
        ok: true,
        command: 'config.profile.export',
        name: 'work',
        output: '/tmp/p.json',
      });
    });

    it('writes raw JSON to stdout in text mode instead of an emitJson envelope', async () => {
      setRuntimeContext(buildRuntimeContext());

      await createProfileCommand().parseAsync(['export', 'work'], { from: 'user' });

      expect(writeFile).not.toHaveBeenCalled();
      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      expect(stdoutWriteSpy.mock.calls[0]?.[0]).toBe(`${exportedJson}\n`);
      expect(ui.success).not.toHaveBeenCalled();
    });

    it('writes raw JSON to stdout in json mode too', async () => {
      await createProfileCommand().parseAsync(['export', 'work'], { from: 'user' });

      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      expect(stdoutWriteSpy.mock.calls[0]?.[0]).toBe(`${exportedJson}\n`);
      expect(jsonPayload()).toEqual(profileConfig);
    });

    it('fails with PROFILE_EXPORT_WRITE_FAILED when the output file cannot be written', async () => {
      vi.mocked(writeFile).mockRejectedValue(new Error('EACCES: permission denied'));

      await createProfileCommand().parseAsync(['export', 'work', '-o', '/root/denied.json'], {
        from: 'user',
      });

      expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
      const payload = jsonPayload();
      expect(payload.error).toMatchObject({
        code: 'PROFILE_EXPORT_WRITE_FAILED',
        category: 'FILESYSTEM',
        context: { name: 'work', output: '/root/denied.json' },
      });
      expect(payload.error.message).toBe(
        'Failed to write profile export to /root/denied.json: EACCES: permission denied'
      );
      expect(payload.error.suggestions).toContain(
        'Check the output directory exists and is writable'
      );
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('profile import', () => {
    it('imports under the requested name and reports the name the manager resolved', async () => {
      vi.mocked(profileManager.import).mockResolvedValue('work');

      await createProfileCommand().parseAsync(['import', './p.json', '--name', 'work'], {
        from: 'user',
      });

      expect(profileManager.initialize).toHaveBeenCalled();
      expect(profileManager.import).toHaveBeenCalledWith('./p.json', 'work');
      expect(jsonPayload()).toEqual({
        ok: true,
        command: 'config.profile.import',
        name: 'work',
        sourceFile: './p.json',
      });
    });

    it('derives the name from the file when --name is omitted', async () => {
      vi.mocked(profileManager.import).mockResolvedValue('p');

      await createProfileCommand().parseAsync(['import', './p.json'], { from: 'user' });

      expect(profileManager.import).toHaveBeenCalledWith('./p.json', undefined);
      expect(jsonPayload()).toMatchObject({ name: 'p', sourceFile: './p.json' });
    });
  });
});
