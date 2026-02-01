import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockProcessExit } from './test-helpers.js';

// Mock dependencies before importing
vi.mock('find-up', () => ({
  findUp: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  access: vi.fn(),
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

import { findUp } from 'find-up';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
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

describe('Agent utilities', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
  });

  afterEach(() => {
    exitMock.mockRestore();
  });

  describe('getProjectRoot', () => {
    it('should return project root when .neo directory exists', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');

      const result = await getProjectRoot();

      expect(result).toBe('/path/to/project');
      expect(findUp).toHaveBeenCalledWith('.neo', { type: 'directory' });
    });

    it('should return null when .neo directory not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      const result = await getProjectRoot();

      expect(result).toBeNull();
    });
  });

  describe('getAgentDir', () => {
    it('should return agent directory path when project root exists', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');

      const result = await getAgentDir();

      expect(result).toBe('/path/to/project/.neo/agent');
    });

    it('should return null when project root not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      const result = await getAgentDir();

      expect(result).toBeNull();
    });
  });

  describe('getAgentDbPath', () => {
    it('should return database path when agent dir exists', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');

      const result = await getAgentDbPath();

      expect(result).toBe('/path/to/project/.neo/agent/context.db');
    });

    it('should return null when agent dir not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      const result = await getAgentDbPath();

      expect(result).toBeNull();
    });
  });

  describe('getAgentConfigPath', () => {
    it('should return config path when agent dir exists', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');

      const result = await getAgentConfigPath();

      expect(result).toBe('/path/to/project/.neo/agent/config.json');
    });

    it('should return null when agent dir not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      const result = await getAgentConfigPath();

      expect(result).toBeNull();
    });
  });

  describe('isAgentInitialized', () => {
    it('should return true when all required files exist', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);

      const result = await isAgentInitialized();

      expect(result).toBe(true);
    });

    it('should return false when agent dir not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      const result = await isAgentInitialized();

      expect(result).toBe(false);
    });

    it('should return false when any file is missing', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await isAgentInitialized();

      expect(result).toBe(false);
    });
  });

  describe('ensureAgentInitialized', () => {
    it('should not exit when agent is initialized', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);

      await ensureAgentInitialized();

      expect(exitMock).not.toHaveBeenCalled();
    });

    it('should exit with error when agent is not initialized', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      await ensureAgentInitialized();

      expect(ui.error).toHaveBeenCalledWith('Agent not initialized in this project');
      expect(ui.warn).toHaveBeenCalledWith('Run: neo agent init');
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('createAgentDir', () => {
    it('should create agent directory when project root exists', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(mkdir).mockResolvedValue(undefined);

      const result = await createAgentDir();

      expect(result).toBe('/path/to/project/.neo/agent');
      expect(mkdir).toHaveBeenCalledWith('/path/to/project/.neo', { recursive: true });
      expect(mkdir).toHaveBeenCalledWith('/path/to/project/.neo/agent', { recursive: true });
    });

    it('should exit when project root not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      // The function calls process.exit but our mock doesn't stop execution
      // So we expect it to throw when trying to use null as path
      await expect(createAgentDir()).rejects.toThrow();

      expect(ui.error).toHaveBeenCalledWith('Not in a Neo project');
      expect(ui.warn).toHaveBeenCalledWith('Run: neo init');
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('loadAgentConfig', () => {
    const validConfig = {
      name: 'test-project',
      created_at: '2024-01-01T00:00:00.000Z',
    };

    it('should load and parse config successfully', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(validConfig));

      const result = await loadAgentConfig();

      expect(result).toBeDefined();
      expect(result?.name).toBe('test-project');
      expect(result?.created_at).toBeInstanceOf(Date);
    });

    it('should return null when agent dir not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      const result = await loadAgentConfig();

      expect(result).toBeNull();
    });

    it('should return null when config file not found', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      const result = await loadAgentConfig();

      expect(result).toBeNull();
    });

    it('should return null and log error on parse failure', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
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
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await saveAgentConfig(config);

      expect(writeFile).toHaveBeenCalled();
    });

    it('should exit when agent dir not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      await saveAgentConfig(config);

      expect(ui.error).toHaveBeenCalledWith('Agent directory not found');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should exit on write failure', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(writeFile).mockRejectedValue(new Error('Write failed'));

      await saveAgentConfig(config);

      expect(ui.error).toHaveBeenCalledWith('Failed to save agent configuration');
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('updateGitignore', () => {
    it('should do nothing when project root not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      await updateGitignore();

      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should do nothing when .gitignore does not exist', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

      await updateGitignore();

      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should not update when already in .gitignore', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('node_modules/\n.neo/agent/\n');

      await updateGitignore();

      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should add entry to .gitignore', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('node_modules/\n');
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await updateGitignore();

      expect(writeFile).toHaveBeenCalled();
      expect(ui.muted).toHaveBeenCalledWith('Added .neo/agent/ to .gitignore');
    });

    it('should handle .gitignore without trailing newline', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
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
      vi.mocked(findUp).mockResolvedValue('/path/to/project/.neo');
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue('node_modules/\n');
      vi.mocked(writeFile).mockRejectedValue(new Error('Write failed'));

      await updateGitignore();

      expect(ui.muted).toHaveBeenCalledWith('Could not update .gitignore');
    });
  });

  describe('getDefaultProjectName', () => {
    it('should return directory name when project root exists', async () => {
      vi.mocked(findUp).mockResolvedValue('/path/to/my-project/.neo');

      const result = await getDefaultProjectName();

      expect(result).toBe('my-project');
    });

    it('should return "unknown-project" when project root not found', async () => {
      vi.mocked(findUp).mockResolvedValue(undefined);

      const result = await getDefaultProjectName();

      expect(result).toBe('unknown-project');
    });

    it('should return "unknown-project" when directory name is empty', async () => {
      vi.mocked(findUp).mockResolvedValue('/.neo');

      const result = await getDefaultProjectName();

      expect(result).toBe('unknown-project');
    });
  });
});
