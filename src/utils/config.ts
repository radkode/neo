import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '@/utils/logger.js';
import type { BannerType } from '@/utils/banner.js';

/**
 * Neo CLI configuration structure
 */
export interface NeoConfig {
  /**
   * Name of the active configuration profile
   * Defaults to 'default' if not specified
   */
  activeProfile?: string;
  ai: {
    enabled: boolean;
    model?: string;
  };
  /**
   * Directory-based auto-switch rules for profiles
   * Keys are glob patterns, values are profile names
   * Example: { "~/work/*": "work", "~/personal/*": "personal" }
   */
  autoSwitch?: Record<string, string>;
  installation: {
    completionsPath?: string;
    globalPath?: string;
    installedAt: string;
    version: string;
  };
  /**
   * Plugin system configuration
   */
  plugins?: {
    /**
     * Whether the plugin system is enabled
     * @default true
     */
    enabled?: boolean;
    /**
     * Custom plugins directory path
     * @default ~/.config/neo/plugins
     */
    directory?: string;
    /**
     * List of plugin names to disable
     */
    disabled?: string[];
  };
  preferences: {
    aliases: {
      n: boolean;
    };
    /**
     * Banner display mode
     * - 'full': Display the complete ASCII art banner (default)
     * - 'compact': Display a minimal, single-line banner
     * - 'none': Do not display any banner
     */
    banner: BannerType;
    editor?: string;
    theme: 'dark' | 'light' | 'auto';
  };
  shell: {
    rcFile: string;
    type: 'zsh' | 'bash' | 'fish';
  };
  updates: {
    lastCheckedAt: string | null;
    latestVersion: string | null;
  };
  user: {
    email?: string;
    name?: string;
  };
}

const DEFAULT_CONFIG: NeoConfig = {
  activeProfile: 'default',
  ai: {
    enabled: true,
    model: 'claude-3-haiku-20240307',
  },
  autoSwitch: {},
  installation: {
    installedAt: new Date().toISOString(),
    version: '0.1.0', // This should be read from package.json in real implementation
  },
  plugins: {
    enabled: true,
  },
  preferences: {
    aliases: {
      n: true,
    },
    banner: 'full',
    theme: 'auto',
  },
  shell: {
    rcFile: join(homedir(), '.zshrc'),
    type: 'zsh',
  },
  updates: {
    lastCheckedAt: null,
    latestVersion: null,
  },
  user: {},
};

export { DEFAULT_CONFIG };

export class ConfigManager {
  private configDir: string;
  private configFile: string;
  private profilesDir: string;

  constructor() {
    this.configDir = join(homedir(), '.config', 'neo');
    this.configFile = join(this.configDir, 'config.json');
    this.profilesDir = join(this.configDir, 'profiles');
  }

  /**
   * Ensures the configuration directory exists
   */
  private async ensureConfigDir(): Promise<void> {
    try {
      await access(this.configDir, constants.F_OK);
    } catch {
      await mkdir(this.configDir, { recursive: true });
      logger.debug(`Created config directory: ${this.configDir}`);
    }
  }

  /**
   * Checks if neo is already initialized
   */
  async isInitialized(): Promise<boolean> {
    try {
      await access(this.configFile, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads the configuration file
   */
  async read(): Promise<NeoConfig> {
    const initialized = await this.isInitialized();
    if (!initialized) {
      return DEFAULT_CONFIG;
    }

    try {
      const content = await readFile(this.configFile, 'utf-8');
      const config = JSON.parse(content) as NeoConfig;

      // Merge with defaults to ensure all properties exist
      return {
        ...DEFAULT_CONFIG,
        ...config,
        ai: { ...DEFAULT_CONFIG.ai, ...config.ai },
        autoSwitch: { ...DEFAULT_CONFIG.autoSwitch, ...config.autoSwitch },
        installation: { ...DEFAULT_CONFIG.installation, ...config.installation },
        plugins: { ...DEFAULT_CONFIG.plugins, ...config.plugins },
        preferences: {
          ...DEFAULT_CONFIG.preferences,
          ...config.preferences,
          aliases: { ...DEFAULT_CONFIG.preferences.aliases, ...config.preferences?.aliases },
        },
        shell: { ...DEFAULT_CONFIG.shell, ...config.shell },
        updates: { ...DEFAULT_CONFIG.updates, ...config.updates },
        user: { ...DEFAULT_CONFIG.user, ...config.user },
      };
    } catch (error) {
      logger.warn(`Failed to read config file: ${error}`);
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Writes the configuration file
   */
  async write(config: NeoConfig): Promise<void> {
    await this.ensureConfigDir();

    try {
      const content = JSON.stringify(config, null, 2);
      await writeFile(this.configFile, content, 'utf-8');
      logger.debug(`Config saved to: ${this.configFile}`);
    } catch (error) {
      logger.error(`Failed to write config file: ${error}`);
      throw error;
    }
  }

  /**
   * Updates a specific configuration value
   */
  async update(updates: Partial<NeoConfig>): Promise<void> {
    const current = await this.read();
    const updated = {
      ...current,
      ...updates,
      ai: { ...current.ai, ...updates.ai },
      autoSwitch: { ...current.autoSwitch, ...updates.autoSwitch },
      installation: { ...current.installation, ...updates.installation },
      plugins: { ...current.plugins, ...updates.plugins },
      preferences: {
        ...current.preferences,
        ...updates.preferences,
        aliases: { ...current.preferences.aliases, ...updates.preferences?.aliases },
      },
      shell: { ...current.shell, ...updates.shell },
      updates: { ...current.updates, ...updates.updates },
      user: { ...current.user, ...updates.user },
    };

    await this.write(updated);
  }

  /**
   * Gets the configuration directory path
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Gets the configuration file path
   */
  getConfigFile(): string {
    return this.configFile;
  }

  /**
   * Gets the profiles directory path
   */
  getProfilesDir(): string {
    return this.profilesDir;
  }

  /**
   * Gets the plugins directory path
   */
  getPluginsDir(): string {
    return join(this.configDir, 'plugins');
  }

  /**
   * Creates a backup of the current configuration
   */
  async backup(): Promise<string | null> {
    const initialized = await this.isInitialized();
    if (!initialized) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = join(this.configDir, `config.backup.${timestamp}.json`);

    try {
      const content = await readFile(this.configFile, 'utf-8');
      await writeFile(backupFile, content, 'utf-8');
      logger.debug(`Config backed up to: ${backupFile}`);
      return backupFile;
    } catch (error) {
      logger.warn(`Failed to backup config: ${error}`);
      return null;
    }
  }
}

export const configManager = new ConfigManager();
