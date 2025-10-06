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
  user: {
    name?: string;
    email?: string;
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
    theme: 'dark' | 'light' | 'auto';
    editor?: string;
  };
  shell: {
    type: 'zsh' | 'bash' | 'fish';
    rcFile: string;
  };
  installation: {
    globalPath?: string;
    completionsPath?: string;
    installedAt: string;
    version: string;
  };
}

const DEFAULT_CONFIG: NeoConfig = {
  user: {},
  preferences: {
    aliases: {
      n: true,
    },
    banner: 'full',
    theme: 'auto',
  },
  shell: {
    type: 'zsh',
    rcFile: join(homedir(), '.zshrc'),
  },
  installation: {
    installedAt: new Date().toISOString(),
    version: '0.1.0', // This should be read from package.json in real implementation
  },
};

export class ConfigManager {
  private configDir: string;
  private configFile: string;

  constructor() {
    this.configDir = join(homedir(), '.config', 'neo');
    this.configFile = join(this.configDir, 'config.json');
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
        user: { ...DEFAULT_CONFIG.user, ...config.user },
        preferences: {
          ...DEFAULT_CONFIG.preferences,
          ...config.preferences,
          aliases: { ...DEFAULT_CONFIG.preferences.aliases, ...config.preferences?.aliases },
        },
        shell: { ...DEFAULT_CONFIG.shell, ...config.shell },
        installation: { ...DEFAULT_CONFIG.installation, ...config.installation },
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
      user: { ...current.user, ...updates.user },
      preferences: {
        ...current.preferences,
        ...updates.preferences,
        aliases: { ...current.preferences.aliases, ...updates.preferences?.aliases },
      },
      shell: { ...current.shell, ...updates.shell },
      installation: { ...current.installation, ...updates.installation },
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
