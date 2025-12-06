import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkForCliUpdates,
  compareVersions,
  notifyIfCliUpdateAvailable,
} from '@/utils/update-check.js';
import type { NeoConfig } from '@/utils/config.js';

const mocks = vi.hoisted(() => ({
  configManager: {
    read: vi.fn(),
    update: vi.fn(),
  },
  logger: {
    debug: vi.fn(),
  },
  ui: {
    muted: vi.fn(),
    warn: vi.fn(),
  },
}));

const fetchMock = vi.fn();

vi.mock('@/utils/config.js', () => ({
  configManager: mocks.configManager,
}));

vi.mock('@/utils/logger.js', () => ({
  logger: mocks.logger,
}));

vi.mock('@/utils/ui.js', () => ({
  ui: mocks.ui,
}));

const baseConfig: NeoConfig = {
  installation: {
    installedAt: '2024-01-01T00:00:00.000Z',
    version: '0.9.2',
  },
  preferences: {
    aliases: {
      n: true,
    },
    banner: 'full',
    theme: 'auto',
  },
  shell: {
    rcFile: '~/.zshrc',
    type: 'zsh',
  },
  updates: {
    lastCheckedAt: null,
    latestVersion: null,
  },
  user: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('compareVersions', () => {
  it('orders greater, equal, and lesser versions', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
  });
});

describe('checkForCliUpdates', () => {
  it('fetches latest version when last check is stale', async () => {
    const oldTimestamp = new Date(0).toISOString();
    mocks.configManager.read.mockResolvedValue({
      ...baseConfig,
      updates: {
        lastCheckedAt: oldTimestamp,
        latestVersion: '0.9.2',
      },
    });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        'dist-tags': { latest: '1.0.0' },
      }),
    });

    const result = await checkForCliUpdates();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.configManager.update).toHaveBeenCalledTimes(1);
    expect(mocks.configManager.update).toHaveBeenCalledWith({
      updates: {
        lastCheckedAt: expect.any(String),
        latestVersion: '1.0.0',
      },
    });
    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe('1.0.0');
  });

  it('uses cached version when check is recent', async () => {
    const now = new Date().toISOString();
    mocks.configManager.read.mockResolvedValue({
      ...baseConfig,
      updates: {
        lastCheckedAt: now,
        latestVersion: '1.0.0',
      },
    });

    const result = await checkForCliUpdates();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.configManager.update).not.toHaveBeenCalled();
    expect(result.latestVersion).toBe('1.0.0');
  });
});

describe('notifyIfCliUpdateAvailable', () => {
  it('prints an upgrade message when update exists', async () => {
    const oldTimestamp = new Date(0).toISOString();
    mocks.configManager.read.mockResolvedValue({
      ...baseConfig,
      updates: {
        lastCheckedAt: oldTimestamp,
        latestVersion: '0.9.2',
      },
    });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        'dist-tags': { latest: '1.0.0' },
      }),
    });

    await notifyIfCliUpdateAvailable();

    expect(mocks.ui.warn).toHaveBeenCalledTimes(1);
    expect(mocks.ui.muted).toHaveBeenCalledTimes(1);
  });
});
