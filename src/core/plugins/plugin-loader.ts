/**
 * Plugin loader for discovering and loading plugins
 */

import { access, readdir, readFile } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';
import type { IPlugin } from '@/core/interfaces/index.js';
import { PluginError } from '@/core/errors/index.js';
import { logger } from '@/utils/logger.js';

/**
 * Plugin manifest from package.json
 */
export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  main?: string;
  author?: string;
  homepage?: string;
  neo?: {
    minVersion?: string;
    enabled?: boolean;
  };
}

/**
 * Result of loading a plugin
 */
export interface LoadedPlugin {
  manifest: PluginManifest;
  plugin: IPlugin;
  path: string;
}

/**
 * Plugin loader for discovering and loading plugins from disk
 */
export class PluginLoader {
  private readonly pluginsDir: string;

  constructor(pluginsDir?: string) {
    this.pluginsDir = pluginsDir ?? join(homedir(), '.config', 'neo', 'plugins');
  }

  /**
   * Get the plugins directory path
   */
  getPluginsDir(): string {
    return this.pluginsDir;
  }

  /**
   * Check if the plugins directory exists
   */
  async pluginsDirExists(): Promise<boolean> {
    try {
      await access(this.pluginsDir, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Discover all plugin directories
   */
  async discoverPlugins(): Promise<PluginManifest[]> {
    const exists = await this.pluginsDirExists();
    if (!exists) {
      logger.debug(`Plugins directory does not exist: ${this.pluginsDir}`);
      return [];
    }

    const manifests: PluginManifest[] = [];
    const entries = await readdir(this.pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginDir = join(this.pluginsDir, entry.name);
      const manifestPath = join(pluginDir, 'package.json');

      try {
        await access(manifestPath, constants.F_OK);
        const content = await readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(content) as PluginManifest;

        if (!manifest.name || !manifest.version) {
          logger.warn(`Invalid plugin manifest in ${entry.name}: missing name or version`);
          continue;
        }

        // Check if plugin is explicitly disabled in manifest
        if (manifest.neo?.enabled === false) {
          logger.debug(`Plugin "${manifest.name}" is disabled in manifest`);
          continue;
        }

        manifests.push(manifest);
        logger.debug(`Discovered plugin: ${manifest.name}@${manifest.version}`);
      } catch (error) {
        logger.debug(`Skipping ${entry.name}: ${error}`);
      }
    }

    return manifests;
  }

  /**
   * Load a single plugin from its manifest
   */
  async loadPlugin(manifest: PluginManifest): Promise<LoadedPlugin> {
    const pluginDir = join(this.pluginsDir, manifest.name);
    const entryPoint = manifest.main ?? 'index.js';
    const modulePath = join(pluginDir, entryPoint);

    try {
      await access(modulePath, constants.F_OK);
    } catch {
      throw new PluginError(
        `Plugin entry point not found: ${entryPoint}`,
        manifest.name,
        {
          suggestions: [
            `Ensure ${entryPoint} exists in the plugin directory`,
            'Check the "main" field in package.json',
          ],
        }
      );
    }

    try {
      // Use file URL for ESM import
      const moduleUrl = pathToFileURL(modulePath).href;
      const module = await import(moduleUrl);
      const plugin = module.default as IPlugin;

      if (!this.isValidPlugin(plugin)) {
        throw new PluginError(
          'Invalid plugin export: missing required properties',
          manifest.name,
          {
            suggestions: [
              'Ensure the plugin has a default export',
              'The export must implement the IPlugin interface',
              'Required: name, version, initialize()',
            ],
          }
        );
      }

      return {
        manifest,
        plugin,
        path: pluginDir,
      };
    } catch (error) {
      if (error instanceof PluginError) throw error;

      const options =
        error instanceof Error
          ? {
              originalError: error,
              suggestions: [
                'Check that the plugin is a valid ESM module',
                'Ensure all dependencies are installed',
                'Verify the plugin code has no syntax errors',
              ],
            }
          : {
              suggestions: [
                'Check that the plugin is a valid ESM module',
                'Ensure all dependencies are installed',
                'Verify the plugin code has no syntax errors',
              ],
            };

      throw new PluginError(
        `Failed to load plugin: ${error instanceof Error ? error.message : String(error)}`,
        manifest.name,
        options
      );
    }
  }

  /**
   * Load all discovered plugins
   */
  async loadAllPlugins(disabledPlugins: string[] = []): Promise<Map<string, LoadedPlugin>> {
    const plugins = new Map<string, LoadedPlugin>();
    const manifests = await this.discoverPlugins();

    for (const manifest of manifests) {
      // Skip disabled plugins
      if (disabledPlugins.includes(manifest.name)) {
        logger.debug(`Plugin "${manifest.name}" is disabled in configuration`);
        continue;
      }

      try {
        const loaded = await this.loadPlugin(manifest);
        plugins.set(manifest.name, loaded);
        logger.debug(`Loaded plugin: ${manifest.name}@${manifest.version}`);
      } catch (error) {
        if (error instanceof PluginError) {
          logger.warn(`Failed to load plugin "${manifest.name}": ${error.message}`);
        } else {
          logger.warn(`Failed to load plugin "${manifest.name}": ${error}`);
        }
        // Continue loading other plugins
      }
    }

    return plugins;
  }

  /**
   * Validate that an object implements IPlugin
   */
  private isValidPlugin(obj: unknown): obj is IPlugin {
    if (!obj || typeof obj !== 'object') return false;

    const plugin = obj as Record<string, unknown>;

    return (
      typeof plugin['name'] === 'string' &&
      typeof plugin['version'] === 'string' &&
      typeof plugin['initialize'] === 'function'
    );
  }
}

// Default singleton instance
export const pluginLoader = new PluginLoader();
