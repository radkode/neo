/**
 * Plugin context factory for initializing plugins
 */

import type { IPluginContext, IConfiguration } from '@/core/interfaces/index.js';
import type { Result } from '@/core/errors/index.js';
import { logger } from '@/utils/logger.js';
import { configManager, type NeoConfig } from '@/utils/config.js';
import { eventBus } from './event-bus.js';
import { commandRegistry } from './command-registry.js';
import { success, failure, PluginError } from '@/core/errors/index.js';
import packageJson from '../../../package.json' with { type: 'json' };

/**
 * Configuration adapter that wraps ConfigManager to implement IConfiguration
 */
class ConfigurationAdapter implements IConfiguration {
  private cache: NeoConfig | null = null;
  private dirty: boolean = false;

  /**
   * Get a configuration value by key (dot notation supported)
   */
  get<T = unknown>(key: string): T | undefined {
    if (!this.cache) {
      return undefined;
    }

    const keys = key.split('.');
    let value: unknown = this.cache;

    for (const k of keys) {
      if (value === null || value === undefined || typeof value !== 'object') {
        return undefined;
      }
      value = (value as Record<string, unknown>)[k];
    }

    return value as T;
  }

  /**
   * Set a configuration value by key (dot notation supported)
   */
  set<T = unknown>(key: string, value: T): void {
    if (!this.cache) {
      this.cache = {} as NeoConfig;
    }

    const keys = key.split('.');
    let current: Record<string, unknown> = this.cache as unknown as Record<string, unknown>;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]!;
      if (!(k in current) || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k] as Record<string, unknown>;
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey !== undefined) {
      current[lastKey] = value;
    }
    this.dirty = true;
  }

  /**
   * Check if a configuration key exists
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a configuration key
   */
  delete(key: string): void {
    if (!this.cache) return;

    const keys = key.split('.');
    let current: Record<string, unknown> = this.cache as unknown as Record<string, unknown>;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]!;
      if (!(k in current) || typeof current[k] !== 'object') {
        return;
      }
      current = current[k] as Record<string, unknown>;
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey !== undefined) {
      delete current[lastKey];
    }
    this.dirty = true;
  }

  /**
   * Clear all configuration
   */
  clear(): void {
    this.cache = {} as NeoConfig;
    this.dirty = true;
  }

  /**
   * Get all configuration values
   */
  getAll(): Record<string, unknown> {
    return (this.cache as unknown as Record<string, unknown>) ?? {};
  }

  /**
   * Validate configuration (always succeeds for now)
   */
  validate(): Result<void> {
    return success(undefined);
  }

  /**
   * Save configuration to disk
   */
  async save(): Promise<Result<void>> {
    if (!this.cache) {
      return failure(new PluginError('No configuration to save', 'config'));
    }

    try {
      await configManager.write(this.cache);
      this.dirty = false;
      return success(undefined);
    } catch (error) {
      const options = error instanceof Error ? { originalError: error } : undefined;
      return failure(new PluginError(`Failed to save configuration: ${error}`, 'config', options));
    }
  }

  /**
   * Load configuration from disk
   */
  async load(): Promise<Result<void>> {
    try {
      this.cache = await configManager.read();
      this.dirty = false;
      return success(undefined);
    } catch (error) {
      const options = error instanceof Error ? { originalError: error } : undefined;
      return failure(new PluginError(`Failed to load configuration: ${error}`, 'config', options));
    }
  }

  /**
   * Check if there are unsaved changes
   */
  isDirty(): boolean {
    return this.dirty;
  }
}

/**
 * Create a plugin context for plugin initialization
 */
export function createPluginContext(): IPluginContext {
  const config = new ConfigurationAdapter();

  // Load config synchronously by caching on first access
  // Plugins should call config.load() if they need fresh data
  configManager.read().then((neoConfig) => {
    (config as unknown as { cache: NeoConfig }).cache = neoConfig;
  });

  return {
    version: packageJson.version,
    config,
    logger,
    eventBus,
    commandRegistry,
  };
}
