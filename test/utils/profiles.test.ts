import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock logger
vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock configManager
vi.mock('@/utils/config.js', () => ({
  configManager: {
    read: vi.fn(),
    update: vi.fn(),
  },
  DEFAULT_CONFIG: {
    ai: { enabled: true, model: 'claude-3-haiku-20240307' },
    preferences: {
      aliases: { n: true },
      banner: 'full',
      theme: 'auto',
    },
    shell: { rcFile: '/home/user/.zshrc', type: 'zsh' },
    user: {},
  },
}));

describe('ProfileManager', () => {
  const accessMock = vi.mocked(access);
  const mkdirMock = vi.mocked(mkdir);
  const readdirMock = vi.mocked(readdir);
  const readFileMock = vi.mocked(readFile);
  const unlinkMock = vi.mocked(unlink);
  const writeFileMock = vi.mocked(writeFile);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('list', () => {
    it('should list available profiles', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const manager = new ProfileManager();

      accessMock.mockResolvedValue(undefined);
      readdirMock.mockResolvedValue(['default.json', 'work.json', 'personal.json'] as unknown as []);

      const profiles = await manager.list();

      expect(profiles).toEqual(['default', 'personal', 'work']);
    });

    it('should return empty array if profiles dir does not exist', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const manager = new ProfileManager();

      accessMock.mockRejectedValue(new Error('ENOENT'));
      mkdirMock.mockResolvedValue(undefined);
      readdirMock.mockResolvedValue([] as unknown as []);

      const profiles = await manager.list();

      expect(profiles).toEqual([]);
    });
  });

  describe('exists', () => {
    it('should return true if profile exists', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const manager = new ProfileManager();

      accessMock.mockResolvedValue(undefined);

      const exists = await manager.exists('work');

      expect(exists).toBe(true);
    });

    it('should return false if profile does not exist', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const manager = new ProfileManager();

      accessMock.mockRejectedValue(new Error('ENOENT'));

      const exists = await manager.exists('nonexistent');

      expect(exists).toBe(false);
    });
  });

  describe('create', () => {
    it('should create a new profile', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const manager = new ProfileManager();

      // Profile doesn't exist yet
      accessMock.mockRejectedValueOnce(new Error('ENOENT')); // ensureProfilesDir check
      mkdirMock.mockResolvedValue(undefined);
      accessMock.mockRejectedValueOnce(new Error('ENOENT')); // exists check
      writeFileMock.mockResolvedValue(undefined);

      await manager.create('work');

      expect(writeFileMock).toHaveBeenCalled();
      const [filePath, content] = writeFileMock.mock.calls[0]!;
      expect(filePath).toContain('work.json');
      expect(content).toContain('"ai"');
      expect(content).toContain('"preferences"');
    });

    it('should throw error if profile already exists', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const manager = new ProfileManager();

      // Profile exists
      accessMock.mockResolvedValue(undefined);

      await expect(manager.create('existing')).rejects.toThrow("Profile 'existing' already exists");
    });
  });

  describe('read', () => {
    it('should read profile configuration', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const manager = new ProfileManager();

      const mockProfile = {
        ai: { enabled: true },
        preferences: { banner: 'compact', theme: 'dark', aliases: { n: false } },
        shell: { type: 'bash', rcFile: '/home/user/.bashrc' },
        user: { name: 'Test User' },
      };

      accessMock.mockResolvedValue(undefined);
      readFileMock.mockResolvedValue(JSON.stringify(mockProfile));

      const profile = await manager.read('work');

      expect(profile).toEqual(mockProfile);
    });

    it('should throw error if profile does not exist', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const manager = new ProfileManager();

      accessMock.mockRejectedValue(new Error('ENOENT'));

      await expect(manager.read('nonexistent')).rejects.toThrow(
        "Profile 'nonexistent' does not exist"
      );
    });
  });

  describe('delete', () => {
    it('should delete a profile', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const { configManager } = await import('@/utils/config.js');
      const manager = new ProfileManager();

      accessMock.mockResolvedValue(undefined);
      vi.mocked(configManager.read).mockResolvedValue({
        activeProfile: 'default',
        ai: { enabled: true },
        autoSwitch: {},
        installation: { installedAt: '', version: '' },
        preferences: { aliases: { n: true }, banner: 'full', theme: 'auto' },
        shell: { rcFile: '', type: 'zsh' },
        updates: { lastCheckedAt: null, latestVersion: null },
        user: {},
      });
      readdirMock.mockResolvedValue(['default.json', 'work.json'] as unknown as []);
      unlinkMock.mockResolvedValue(undefined);

      await manager.delete('work');

      expect(unlinkMock).toHaveBeenCalled();
    });

    it('should throw error when deleting active profile', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const { configManager } = await import('@/utils/config.js');
      const manager = new ProfileManager();

      accessMock.mockResolvedValue(undefined);
      vi.mocked(configManager.read).mockResolvedValue({
        activeProfile: 'work',
        ai: { enabled: true },
        autoSwitch: {},
        installation: { installedAt: '', version: '' },
        preferences: { aliases: { n: true }, banner: 'full', theme: 'auto' },
        shell: { rcFile: '', type: 'zsh' },
        updates: { lastCheckedAt: null, latestVersion: null },
        user: {},
      });

      await expect(manager.delete('work')).rejects.toThrow(
        "Cannot delete active profile 'work'"
      );
    });
  });

  describe('setActive', () => {
    it('should set the active profile', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const { configManager } = await import('@/utils/config.js');
      const manager = new ProfileManager();

      accessMock.mockResolvedValue(undefined);
      vi.mocked(configManager.update).mockResolvedValue(undefined);

      await manager.setActive('work');

      expect(configManager.update).toHaveBeenCalledWith({ activeProfile: 'work' });
    });

    it('should throw error if profile does not exist', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const manager = new ProfileManager();

      accessMock.mockRejectedValue(new Error('ENOENT'));

      await expect(manager.setActive('nonexistent')).rejects.toThrow(
        "Profile 'nonexistent' does not exist"
      );
    });
  });

  describe('detectProfile', () => {
    it('should detect profile based on directory pattern', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const { configManager } = await import('@/utils/config.js');
      const manager = new ProfileManager();

      vi.mocked(configManager.read).mockResolvedValue({
        activeProfile: 'default',
        ai: { enabled: true },
        autoSwitch: {
          '~/work/*': 'work',
          '~/personal/*': 'personal',
        },
        installation: { installedAt: '', version: '' },
        preferences: { aliases: { n: true }, banner: 'full', theme: 'auto' },
        shell: { rcFile: '', type: 'zsh' },
        updates: { lastCheckedAt: null, latestVersion: null },
        user: {},
      });

      // Profile exists
      accessMock.mockResolvedValue(undefined);

      const profile = await manager.detectProfile(join(homedir(), 'work', 'project'));

      expect(profile).toBe('work');
    });

    it('should return null if no matching pattern', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const { configManager } = await import('@/utils/config.js');
      const manager = new ProfileManager();

      vi.mocked(configManager.read).mockResolvedValue({
        activeProfile: 'default',
        ai: { enabled: true },
        autoSwitch: {
          '~/work/*': 'work',
        },
        installation: { installedAt: '', version: '' },
        preferences: { aliases: { n: true }, banner: 'full', theme: 'auto' },
        shell: { rcFile: '', type: 'zsh' },
        updates: { lastCheckedAt: null, latestVersion: null },
        user: {},
      });

      const profile = await manager.detectProfile('/some/other/path');

      expect(profile).toBeNull();
    });

    it('should return null if autoSwitch is empty', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const { configManager } = await import('@/utils/config.js');
      const manager = new ProfileManager();

      vi.mocked(configManager.read).mockResolvedValue({
        activeProfile: 'default',
        ai: { enabled: true },
        autoSwitch: {},
        installation: { installedAt: '', version: '' },
        preferences: { aliases: { n: true }, banner: 'full', theme: 'auto' },
        shell: { rcFile: '', type: 'zsh' },
        updates: { lastCheckedAt: null, latestVersion: null },
        user: {},
      });

      const profile = await manager.detectProfile('/any/path');

      expect(profile).toBeNull();
    });
  });

  describe('export', () => {
    it('should export profile as JSON string', async () => {
      const { ProfileManager } = await import('@/utils/profiles.js');
      const manager = new ProfileManager();

      const mockProfile = {
        ai: { enabled: true },
        preferences: { banner: 'compact', theme: 'dark', aliases: { n: false } },
        shell: { type: 'bash', rcFile: '/home/user/.bashrc' },
        user: { name: 'Test User' },
      };

      accessMock.mockResolvedValue(undefined);
      readFileMock.mockResolvedValue(JSON.stringify(mockProfile));

      const exported = await manager.export('work');

      expect(JSON.parse(exported)).toEqual(mockProfile);
    });
  });
});
