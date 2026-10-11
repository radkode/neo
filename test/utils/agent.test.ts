import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockProcessExit } from './test-helpers.js';
import { dirname } from 'path';

// Mock dependencies before importing
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  access: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    warn: vi.fn(),
    muted: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { execa } from 'execa';
import { access, lstat, mkdir, readFile, writeFile } from 'fs/promises';
import { ui } from '@/utils/ui.js';
import {
  getProjectRoot,
  getAgentDir,
  getAgentDbPath,
  getAgentConfigPath,
  isAgentInitialized,
  ensureAgentInitialized,
  createAgentDir,
  loadAgentConfig,
  saveAgentConfig,
  updateGitignore,
  getDefaultProjectName,
} from '../../src/utils/agent.js';

function mockNeoDir(path?: string): void {
  if (path) {
    const root = dirname(path);
    vi.mocked(execa).mockResolvedValue({ stdout: `${root}/.git\n${root}` } as never);
  } else {
    vi.mocked(lstat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  }
}

describe('Agent utilities', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execa).mockResolvedValue({
      stdout: '/path/to/project/.git\n/path/to/project',
    } as never);
    vi.mocked(lstat).mockImplementation(async (path) => {
      if (String(path).endsWith('contexts.json')) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      return { isDirectory: () => true } as never;
    });
    exitMock = mockProcessExit();
  });

  afterEach(() => {
    exitMock.mockRestore();
  });

  describe('getProjectRoot', () => {
    it('should return project root when .neo directory exists', async () => {
      mockNeoDir('/path/to/project/.neo');

      const result = await getProjectRoot();

      expect(result).toBe('/path/to/project');
      expect(execa).toHaveBeenCalledWith('git', [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
        '--show-toplevel',
      ]);
    });

    it('should return null when .neo directory not found', async () => {
      mockNeoDir(undefined);

      const result = await getProjectRoot();

      expect(result).toBeNull();
    });
  });

  describe('getAgentDir', () => {
    it('should return agent directory path when project root exists', async () => {
      mockNeoDir('/path/to/project/.neo');

      const result = await getAgentDir();

      expect(result).toBe('/path/to/project/.neo/agent');
    });

    it('should return null when project root not found', async () => {
      mockNeoDir(undefined);

      const result = await getAgentDir();

      expect(result).toBeNull();
    });
  });

  describe('getAgentDbPath', () => {
    it('should return database path when agent dir exists', async () => {
      mockNeoDir('/path/to/project/.neo');

      const result = await getAgentDbPath();

      expect(result).toBe('/path/to/project/.neo/agent/contexts.json');
    });

    it('should return null when agent dir not found', async () => {
      mockNeoDir(undefined);

      const result = await getAgentDbPath();

      expect(result).toBeNull();
    });
  });

  describe('getAgentConfigPath', () => {
    it('should return config path when agent dir exists', async () => {
      mockNeoDir('/path/to/project/.neo');

      const result = await getAgentConfigPath();

      expect(result).toBe('/path/to/project/.neo/agent/config.json');
    });

    it('should return null when agent dir not found', async () => {
      mockNeoDir(undefined);

      const result = await getAgentConfigPath();

      expect(result).toBeNull();
    });
  });

  describe('isAgentInitialized', () => {
    it('should return true when all required files exist', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);

      const result = await isAgentInitialized();

      expect(result).toBe(true);
    });

    it('should return false when agent dir not found', async () => {
      mockNeoDir(undefined);

      const result = await isAgentInitialized();

      expect(result).toBe(false);
    });

    it('should return false when any file is missing', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await isAgentInitialized();

      expect(result).toBe(false);
    });
  });

  describe('ensureAgentInitialized', () => {
    it('should not exit when agent is initialized', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);

      await ensureAgentInitialized();

      expect(exitMock).not.toHaveBeenCalled();
    });

    it('should throw when agent is not initialized', async () => {
      mockNeoDir(undefined);

      await expect(ensureAgentInitialized()).rejects.toThrow(
        'Agent not initialized in this project'
      );
    });
  });

  describe('createAgentDir', () => {
    it('should create agent directory when project root exists', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(mkdir).mockResolvedValue(undefined);

      const result = await createAgentDir();

      expect(result).toBe('/path/to/project/.neo/agent');
      expect(mkdir).toHaveBeenCalledWith('/path/to/project/.neo/agent', { mode: 0o700 });
    });

    it('should throw when project root not found', async () => {
      mockNeoDir(undefined);

      await expect(createAgentDir()).rejects.toThrow('Not in a Neo project');
    });
  });

  describe('loadAgentConfig', () => {
    const validConfig = {
      name: 'test-project',
      created_at: '2024-01-01T00:00:00.000Z',
    };

    it('should load and parse config successfully', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(validConfig));

      const result = await loadAgentConfig();

      expect(result).toBeDefined();
      expect(result?.name).toBe('test-project');
      expect(result?.created_at).toBeInstanceOf(Date);
    });

    it('should return null when agent dir not found', async () => {
      mockNeoDir(undefined);

      const result = await loadAgentConfig();

      expect(result).toBeNull();
    });

    it('should return null when config file not found', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const result = await loadAgentConfig();

      expect(result).toBeNull();
    });

    it('should return null and log error on parse failure', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('invalid json');

      const result = await loadAgentConfig();

      expect(result).toBeNull();
      expect(ui.error).toHaveBeenCalledWith('Failed to load agent configuration');
    });
  });

  describe('saveAgentConfig', () => {
    const config = {
      name: 'test-project',
      created_at: new Date('2024-01-01T00:00:00.000Z'),
    };

    it('should save config successfully', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await saveAgentConfig(config);

      expect(writeFile).toHaveBeenCalled();
    });

    it('should throw when agent dir not found', async () => {
      mockNeoDir(undefined);

      await expect(saveAgentConfig(config)).rejects.toThrow('Agent directory not found');
    });

    it('should throw on write failure', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(writeFile).mockRejectedValue(new Error('Write failed'));

      await expect(saveAgentConfig(config)).rejects.toThrow('Failed to save agent configuration');
    });
  });

  describe('updateGitignore', () => {
    it('should do nothing when project root not found', async () => {
      mockNeoDir(undefined);

      await updateGitignore();

      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should do nothing when .gitignore does not exist', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      await updateGitignore();

      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should not update when already in .gitignore', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('node_modules/\n.neo/agent/\n');

      await updateGitignore();

      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should add entry to .gitignore', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('node_modules/\n');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await updateGitignore();

      expect(writeFile).toHaveBeenCalled();
      expect(ui.muted).toHaveBeenCalledWith('Added .neo/agent/ to .gitignore');
    });

    it('should handle .gitignore without trailing newline', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('node_modules/');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await updateGitignore();

      expect(writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('\n.neo/agent/\n'),
        expect.any(String)
      );
    });

    it('should handle write error silently', async () => {
      mockNeoDir('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('node_modules/\n');
      vi.mocked(writeFile).mockRejectedValue(new Error('Write failed'));

      await updateGitignore();

      expect(ui.muted).toHaveBeenCalledWith('Could not update .gitignore');
    });
  });

  describe('getDefaultProjectName', () => {
    it('should return directory name when project root exists', async () => {
      mockNeoDir('/path/to/my-project/.neo');

      const result = await getDefaultProjectName();

      expect(result).toBe('my-project');
    });

    it('should return "unknown-project" when project root not found', async () => {
      mockNeoDir(undefined);

      const result = await getDefaultProjectName();

      expect(result).toBe('unknown-project');
    });

    it('should return "unknown-project" when directory name is empty', async () => {
      mockNeoDir('/.neo');

      const result = await getDefaultProjectName();

      expect(result).toBe('unknown-project');
    });
  });
});
