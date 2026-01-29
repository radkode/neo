/**
 * Plugin registry for managing plugin lifecycle
 */

import type { IPlugin } from '@/core/interfaces/index.js';
import type { Result } from '@/core/errors/index.js';
import { logger } from '@/utils/logger.js';
import { createPluginContext } from './plugin-context.js';
import { pluginLoader, type LoadedPlugin } from './plugin-loader.js';
import { commandRegistry } from './command-registry.js';

/**
 * Plugin state tracking
 */
enum PluginState {
  LOADED = 'loaded',
  INITIALIZED = 'initialized',
  ERROR = 'error',
  DISPOSED = 'disposed',
}

interface RegisteredPlugin {
  plugin: IPlugin;
  state: PluginState;
  path: string;
  error?: Error;
}

/**
 * Registry for managing loaded plugins and their lifecycle
 */
export class PluginRegistry {
  private plugins: Map<string, RegisteredPlugin> = new Map();

  /**
   * Register a loaded plugin
   */
  registerPlugin(loaded: LoadedPlugin): void {
    if (this.plugins.has(loaded.plugin.name)) {
      logger.warn(`Plugin "${loaded.plugin.name}" is already registered`);
      return;
    }

    this.plugins.set(loaded.plugin.name, {
      plugin: loaded.plugin,
      state: PluginState.LOADED,
      path: loaded.path,
    });

    logger.debug(`Registered plugin: ${loaded.plugin.name}`);
  }

  /**
   * Initialize all registered plugins
   */
  async initializeAll(): Promise<void> {
    const context = createPluginContext();

    // Pre-load configuration
    await context.config.load();

    for (const [name, registered] of this.plugins) {
      if (registered.state !== PluginState.LOADED) continue;

      try {
        await registered.plugin.initialize(context);
        registered.state = PluginState.INITIALIZED;

        // Register plugin commands
        if (registered.plugin.commands) {
          for (const command of registered.plugin.commands) {
            try {
              commandRegistry.register(command, {
                name: command.name,
                description: command.description,
                group: name, // Use plugin name as command group
              });
              logger.debug(`Registered command "${command.name}" from plugin "${name}"`);
            } catch (error) {
              logger.warn(`Failed to register command "${command.name}": ${error}`);
            }
          }
        }

        logger.debug(`Initialized plugin: ${name}`);
      } catch (error) {
        registered.state = PluginState.ERROR;
        registered.error = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Failed to initialize plugin "${name}": ${error}`);
      }
    }
  }

  /**
   * Dispose all initialized plugins
   */
  async disposeAll(): Promise<void> {
    for (const [name, registered] of this.plugins) {
      if (registered.state !== PluginState.INITIALIZED) continue;

      try {
        if (registered.plugin.dispose) {
          await registered.plugin.dispose();
        }
        registered.state = PluginState.DISPOSED;
        logger.debug(`Disposed plugin: ${name}`);
      } catch (error) {
        logger.warn(`Error disposing plugin "${name}": ${error}`);
      }
    }

    // Clear command registry
    commandRegistry.clear();
  }

  /**
   * Get a plugin by name
   */
  getPlugin(name: string): IPlugin | undefined {
    return this.plugins.get(name)?.plugin;
  }

  /**
   * Get all loaded plugins
   */
  getLoadedPlugins(): IPlugin[] {
    return Array.from(this.plugins.values()).map((r) => r.plugin);
  }

  /**
   * Get all initialized plugins
   */
  getInitializedPlugins(): IPlugin[] {
    return Array.from(this.plugins.values())
      .filter((r) => r.state === PluginState.INITIALIZED)
      .map((r) => r.plugin);
  }

  /**
   * Execute beforeCommand hooks for all plugins
   */
  async executeBeforeCommand(commandName: string, options: unknown): Promise<void> {
    for (const plugin of this.getInitializedPlugins()) {
      if (!plugin.hooks?.beforeCommand) continue;

      try {
        await plugin.hooks.beforeCommand(commandName, options);
      } catch (error) {
        logger.debug(`Plugin "${plugin.name}" beforeCommand hook error: ${error}`);
      }
    }
  }

  /**
   * Execute afterCommand hooks for all plugins
   */
  async executeAfterCommand(commandName: string, result: Result<void>): Promise<void> {
    for (const plugin of this.getInitializedPlugins()) {
      if (!plugin.hooks?.afterCommand) continue;

      try {
        await plugin.hooks.afterCommand(commandName, result);
      } catch (error) {
        logger.debug(`Plugin "${plugin.name}" afterCommand hook error: ${error}`);
      }
    }
  }

  /**
   * Execute onError hooks for all plugins
   */
  async executeOnError(error: Error): Promise<void> {
    for (const plugin of this.getInitializedPlugins()) {
      if (!plugin.hooks?.onError) continue;

      try {
        await plugin.hooks.onError(error);
      } catch (hookError) {
        logger.debug(`Plugin "${plugin.name}" onError hook error: ${hookError}`);
      }
    }
  }

  /**
   * Execute onExit hooks for all plugins
   */
  async executeOnExit(code: number): Promise<void> {
    for (const plugin of this.getInitializedPlugins()) {
      if (!plugin.hooks?.onExit) continue;

      try {
        await plugin.hooks.onExit(code);
      } catch (error) {
        logger.debug(`Plugin "${plugin.name}" onExit hook error: ${error}`);
      }
    }
  }

  /**
   * Load and initialize plugins from disk
   */
  async loadPlugins(disabledPlugins: string[] = []): Promise<void> {
    const loaded = await pluginLoader.loadAllPlugins(disabledPlugins);

    for (const [, loadedPlugin] of loaded) {
      this.registerPlugin(loadedPlugin);
    }

    await this.initializeAll();
  }

  /**
   * Get plugin count
   */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * Clear all plugins
   */
  clear(): void {
    this.plugins.clear();
  }
}

// Singleton instance
export const pluginRegistry = new PluginRegistry();
