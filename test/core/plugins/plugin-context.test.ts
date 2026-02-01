import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPluginContext } from '../../../src/core/plugins/plugin-context.js';
import type { IConfiguration } from '../../../src/core/interfaces/index.js';

// Mock dependencies
vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/config.js', () => ({
  configManager: {
    read: vi.fn(),
    write: vi.fn(),
  },
}));

vi.mock('../../../src/core/plugins/event-bus.js', () => ({
  eventBus: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock('../../../src/core/plugins/command-registry.js', () => ({
  commandRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
  },
}));

import { configManager } from '@/utils/config.js';

describe('createPluginContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configManager.read).mockResolvedValue({} as never);
  });

  it('should create a plugin context with required properties', () => {
    const context = createPluginContext();

    expect(context).toHaveProperty('version');
    expect(context).toHaveProperty('config');
    expect(context).toHaveProperty('logger');
    expect(context).toHaveProperty('eventBus');
    expect(context).toHaveProperty('commandRegistry');
  });

  it('should have a version string', () => {
    const context = createPluginContext();

    expect(typeof context.version).toBe('string');
    expect(context.version.length).toBeGreaterThan(0);
  });

  it('should provide access to logger', () => {
    const context = createPluginContext();

    expect(context.logger).toBeDefined();
    expect(typeof context.logger.debug).toBe('function');
    expect(typeof context.logger.info).toBe('function');
    expect(typeof context.logger.warn).toBe('function');
    expect(typeof context.logger.error).toBe('function');
  });

  it('should provide access to eventBus', () => {
    const context = createPluginContext();

    expect(context.eventBus).toBeDefined();
    expect(typeof context.eventBus.on).toBe('function');
    expect(typeof context.eventBus.off).toBe('function');
    expect(typeof context.eventBus.emit).toBe('function');
  });

  it('should provide access to commandRegistry', () => {
    const context = createPluginContext();

    expect(context.commandRegistry).toBeDefined();
    expect(typeof context.commandRegistry.register).toBe('function');
    expect(typeof context.commandRegistry.unregister).toBe('function');
  });
});

describe('ConfigurationAdapter', () => {
  let config: IConfiguration;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(configManager.read).mockResolvedValue({
      preferences: {
        banner: 'full',
        theme: 'auto',
      },
      ai: {
        enabled: true,
      },
    } as never);

    const context = createPluginContext();
    config = context.config;
  });

  describe('get', () => {
    it('should return undefined when cache is null', () => {
      // Create a fresh context without loading
      vi.mocked(configManager.read).mockResolvedValue({} as never);
      const freshContext = createPluginContext();

      // Before the async load completes, cache is null
      const result = freshContext.config.get('anything');
      expect(result).toBeUndefined();
    });

    it('should get nested value using dot notation', async () => {
      // Wait for async config load
      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = config.get('preferences.banner');
      expect(result).toBe('full');
    });

    it('should return undefined for non-existent path', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = config.get('nonexistent.path');
      expect(result).toBeUndefined();
    });

    it('should return whole object for partial path', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = config.get('preferences');
      expect(result).toEqual({ banner: 'full', theme: 'auto' });
    });
  });

  describe('set', () => {
    it('should set a value using dot notation', () => {
      config.set('preferences.banner', 'compact');

      expect(config.get('preferences.banner')).toBe('compact');
      expect(config.isDirty()).toBe(true);
    });

    it('should create intermediate objects', () => {
      config.set('new.deeply.nested.value', 'test');

      expect(config.get('new.deeply.nested.value')).toBe('test');
    });

    it('should mark config as dirty', () => {
      config.set('test.key', 'value');

      expect(config.isDirty()).toBe(true);
    });

    it('should handle setting when cache is null', () => {
      vi.mocked(configManager.read).mockResolvedValue({} as never);
      const freshContext = createPluginContext();

      freshContext.config.set('new.key', 'value');

      expect(freshContext.config.get('new.key')).toBe('value');
    });
  });

  describe('has', () => {
    it('should return true for existing key', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(config.has('preferences.banner')).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(config.has('nonexistent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a key', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      config.delete('preferences.banner');

      expect(config.has('preferences.banner')).toBe(false);
      expect(config.isDirty()).toBe(true);
    });

    it('should handle deleting non-existent key', () => {
      config.delete('nonexistent.path');

      // Should not throw
      expect(config.has('nonexistent.path')).toBe(false);
    });

    it('should handle deleting when cache is null', () => {
      vi.mocked(configManager.read).mockResolvedValue({} as never);
      const freshContext = createPluginContext();

      // Should not throw
      freshContext.config.delete('any.key');
    });
  });

  describe('clear', () => {
    it('should clear all configuration', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      config.clear();

      expect(config.getAll()).toEqual({});
      expect(config.isDirty()).toBe(true);
    });
  });

  describe('getAll', () => {
    it('should return all configuration', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      const all = config.getAll();

      expect(all).toEqual({
        preferences: { banner: 'full', theme: 'auto' },
        ai: { enabled: true },
      });
    });

    it('should return empty object when cache is null', () => {
      vi.mocked(configManager.read).mockResolvedValue({} as never);
      const freshContext = createPluginContext();

      // Before async load
      const all = freshContext.config.getAll();
      expect(all).toEqual({});
    });
  });

  describe('validate', () => {
    it('should return success', () => {
      const result = config.validate();

      expect(result.success).toBe(true);
    });
  });

  describe('save', () => {
    it('should save configuration to disk', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      vi.mocked(configManager.write).mockResolvedValue(undefined);

      config.set('test', 'value');
      const result = await config.save();

      expect(result.success).toBe(true);
      expect(configManager.write).toHaveBeenCalled();
      expect(config.isDirty()).toBe(false);
    });

    it('should return failure when cache is null', async () => {
      vi.mocked(configManager.read).mockResolvedValue({} as never);
      const freshContext = createPluginContext();

      const result = await freshContext.config.save();

      expect(result.success).toBe(false);
    });

    it('should return failure on write error', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      vi.mocked(configManager.write).mockRejectedValue(new Error('Write failed'));

      const result = await config.save();

      expect(result.success).toBe(false);
    });
  });

  describe('load', () => {
    it('should load configuration from disk', async () => {
      vi.mocked(configManager.read).mockResolvedValue({
        newKey: 'newValue',
      } as never);

      const result = await config.load();

      expect(result.success).toBe(true);
      expect(config.get('newKey')).toBe('newValue');
      expect(config.isDirty()).toBe(false);
    });

    it('should return failure on read error', async () => {
      vi.mocked(configManager.read).mockRejectedValue(new Error('Read failed'));

      const result = await config.load();

      expect(result.success).toBe(false);
    });
  });

  describe('isDirty', () => {
    it('should return false initially', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      // After load, dirty should be false
      await config.load();
      expect(config.isDirty()).toBe(false);
    });

    it('should return true after modification', () => {
      config.set('test', 'value');

      expect(config.isDirty()).toBe(true);
    });

    it('should return false after save', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      vi.mocked(configManager.write).mockResolvedValue(undefined);

      config.set('test', 'value');
      await config.save();

      expect(config.isDirty()).toBe(false);
    });
  });
});
