import { access, mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';
import { logger } from '@/utils/logger.js';
import { configManager, DEFAULT_CONFIG, type NeoConfig } from '@/utils/config.js';

/**
 * Profile data structure (subset of NeoConfig relevant to profiles)
 * Excludes system-level fields like installation and updates
 */
export type ProfileConfig = Omit<NeoConfig, 'activeProfile' | 'autoSwitch' | 'installation' | 'updates'>;

/**
 * Manages configuration profiles for Neo CLI
 */
export class ProfileManager {
  private profilesDir: string;

  constructor() {
    this.profilesDir = join(homedir(), '.config', 'neo', 'profiles');
  }

  /**
   * Ensures the profiles directory exists
   */
  private async ensureProfilesDir(): Promise<void> {
    try {
      await access(this.profilesDir, constants.F_OK);
    } catch {
      await mkdir(this.profilesDir, { recursive: true });
      logger.debug(`Created profiles directory: ${this.profilesDir}`);
    }
  }

  /**
   * Gets the file path for a profile
   */
  private getProfilePath(name: string): string {
    return join(this.profilesDir, `${name}.json`);
  }

  /**
   * Checks if a profile exists
   */
  async exists(name: string): Promise<boolean> {
    try {
      await access(this.getProfilePath(name), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists all available profiles
   */
  async list(): Promise<string[]> {
    await this.ensureProfilesDir();

    try {
      const files = await readdir(this.profilesDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => basename(f, '.json'))
        .sort();
    } catch (error) {
      logger.warn(`Failed to list profiles: ${error}`);
      return [];
    }
  }

  /**
   * Creates a new profile
   */
  async create(name: string, config?: Partial<ProfileConfig>): Promise<void> {
    await this.ensureProfilesDir();

    const profilePath = this.getProfilePath(name);

    if (await this.exists(name)) {
      throw new Error(`Profile '${name}' already exists`);
    }

    const defaultProfileConfig: ProfileConfig = {
      ai: DEFAULT_CONFIG.ai,
      preferences: DEFAULT_CONFIG.preferences,
      shell: DEFAULT_CONFIG.shell,
      user: DEFAULT_CONFIG.user,
    };

    const profileConfig: ProfileConfig = config
      ? {
          ...defaultProfileConfig,
          ...config,
          ai: { ...defaultProfileConfig.ai, ...config.ai },
          preferences: {
            ...defaultProfileConfig.preferences,
            ...config.preferences,
            aliases: {
              ...defaultProfileConfig.preferences.aliases,
              ...config.preferences?.aliases,
            },
          },
          shell: { ...defaultProfileConfig.shell, ...config.shell },
          user: { ...defaultProfileConfig.user, ...config.user },
        }
      : defaultProfileConfig;

    try {
      const content = JSON.stringify(profileConfig, null, 2);
      await writeFile(profilePath, content, 'utf-8');
      logger.debug(`Created profile: ${name}`);
    } catch (error) {
      logger.error(`Failed to create profile: ${error}`);
      throw error;
    }
  }

  /**
   * Reads a profile configuration
   */
  async read(name: string): Promise<ProfileConfig> {
    const profilePath = this.getProfilePath(name);

    if (!(await this.exists(name))) {
      throw new Error(`Profile '${name}' does not exist`);
    }

    try {
      const content = await readFile(profilePath, 'utf-8');
      return JSON.parse(content) as ProfileConfig;
    } catch (error) {
      logger.error(`Failed to read profile: ${error}`);
      throw error;
    }
  }

  /**
   * Updates a profile configuration
   */
  async update(name: string, updates: Partial<ProfileConfig>): Promise<void> {
    const current = await this.read(name);
    const updated: ProfileConfig = {
      ...current,
      ...updates,
      ai: { ...current.ai, ...updates.ai },
      preferences: {
        ...current.preferences,
        ...updates.preferences,
        aliases: { ...current.preferences.aliases, ...updates.preferences?.aliases },
      },
      shell: { ...current.shell, ...updates.shell },
      user: { ...current.user, ...updates.user },
    };

    const profilePath = this.getProfilePath(name);
    try {
      const content = JSON.stringify(updated, null, 2);
      await writeFile(profilePath, content, 'utf-8');
      logger.debug(`Updated profile: ${name}`);
    } catch (error) {
      logger.error(`Failed to update profile: ${error}`);
      throw error;
    }
  }

  /**
   * Deletes a profile
   */
  async delete(name: string): Promise<void> {
    if (!(await this.exists(name))) {
      throw new Error(`Profile '${name}' does not exist`);
    }

    // Check if this is the active profile
    const config = await configManager.read();
    if (config.activeProfile === name) {
      throw new Error(`Cannot delete active profile '${name}'. Switch to another profile first.`);
    }

    // Prevent deleting the default profile if it's the only one
    const profiles = await this.list();
    if (name === 'default' && profiles.length === 1) {
      throw new Error(`Cannot delete the only remaining profile 'default'`);
    }

    const profilePath = this.getProfilePath(name);
    try {
      await unlink(profilePath);
      logger.debug(`Deleted profile: ${name}`);
    } catch (error) {
      logger.error(`Failed to delete profile: ${error}`);
      throw error;
    }
  }

  /**
   * Gets the active profile name
   */
  async getActive(): Promise<string> {
    const config = await configManager.read();
    return config.activeProfile || 'default';
  }

  /**
   * Sets the active profile
   */
  async setActive(name: string): Promise<void> {
    if (!(await this.exists(name))) {
      throw new Error(`Profile '${name}' does not exist`);
    }

    await configManager.update({ activeProfile: name });
    logger.debug(`Switched to profile: ${name}`);
  }

  /**
   * Gets the active profile configuration merged with base config
   */
  async getActiveConfig(): Promise<NeoConfig> {
    const baseConfig = await configManager.read();
    const activeProfileName = baseConfig.activeProfile || 'default';

    // If profile doesn't exist, return base config
    if (!(await this.exists(activeProfileName))) {
      return baseConfig;
    }

    const profileConfig = await this.read(activeProfileName);

    // Merge profile config with base config
    return {
      ...baseConfig,
      ai: { ...baseConfig.ai, ...profileConfig.ai },
      preferences: {
        ...baseConfig.preferences,
        ...profileConfig.preferences,
        aliases: { ...baseConfig.preferences.aliases, ...profileConfig.preferences?.aliases },
      },
      shell: { ...baseConfig.shell, ...profileConfig.shell },
      user: { ...baseConfig.user, ...profileConfig.user },
    };
  }

  /**
   * Detects which profile should be used based on current directory
   * Returns null if no matching auto-switch rule found
   *
   * Supports patterns like:
   * - "~/work/*" - matches any subdirectory of ~/work
   * - "~/work/project" - matches exact path
   * - "/absolute/path/*" - matches any subdirectory
   */
  async detectProfile(cwd: string): Promise<string | null> {
    const config = await configManager.read();
    const autoSwitch = config.autoSwitch;

    if (!autoSwitch || Object.keys(autoSwitch).length === 0) {
      return null;
    }

    // Expand ~ to home directory
    const expandPath = (pattern: string): string => {
      if (pattern.startsWith('~/')) {
        return join(homedir(), pattern.slice(2));
      }
      return pattern;
    };

    // Simple glob matching for directory patterns
    const matchesPattern = (path: string, pattern: string): boolean => {
      const expandedPattern = expandPath(pattern);

      // Handle wildcard patterns (e.g., ~/work/*)
      if (expandedPattern.endsWith('/*')) {
        const basePattern = expandedPattern.slice(0, -2);
        return path.startsWith(basePattern + '/') || path === basePattern;
      }

      // Handle double wildcard (e.g., ~/work/**)
      if (expandedPattern.endsWith('/**')) {
        const basePattern = expandedPattern.slice(0, -3);
        return path.startsWith(basePattern + '/') || path === basePattern;
      }

      // Exact match
      return path === expandedPattern;
    };

    // Check each pattern (longer/more specific patterns first)
    const sortedPatterns = Object.entries(autoSwitch).sort(
      ([a], [b]) => expandPath(b).length - expandPath(a).length
    );

    for (const [pattern, profileName] of sortedPatterns) {
      if (matchesPattern(cwd, pattern)) {
        // Verify the profile exists
        if (await this.exists(profileName)) {
          return profileName;
        }
        logger.warn(`Auto-switch profile '${profileName}' for pattern '${pattern}' does not exist`);
      }
    }

    return null;
  }

  /**
   * Exports a profile to JSON string
   */
  async export(name: string): Promise<string> {
    const profileConfig = await this.read(name);
    return JSON.stringify(profileConfig, null, 2);
  }

  /**
   * Imports a profile from a file
   */
  async import(filePath: string, name?: string): Promise<string> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const profileConfig = JSON.parse(content) as ProfileConfig;

      // Determine the profile name
      const profileName = name || basename(filePath, '.json');

      // Validate that it has expected structure
      if (!profileConfig.preferences || !profileConfig.shell) {
        throw new Error('Invalid profile format: missing required sections');
      }

      await this.create(profileName, profileConfig);
      return profileName;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in profile file: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Copies an existing profile to a new name
   */
  async copy(sourceName: string, targetName: string): Promise<void> {
    const sourceConfig = await this.read(sourceName);
    await this.create(targetName, sourceConfig);
  }

  /**
   * Gets the profiles directory path
   */
  getProfilesDir(): string {
    return this.profilesDir;
  }

  /**
   * Initializes profile system by creating default profile if needed
   */
  async initialize(): Promise<void> {
    await this.ensureProfilesDir();

    // Create default profile if it doesn't exist
    if (!(await this.exists('default'))) {
      const config = await configManager.read();
      await this.create('default', {
        ai: config.ai,
        preferences: config.preferences,
        shell: config.shell,
        user: config.user,
      });
      logger.debug('Created default profile');
    }
  }
}

export const profileManager = new ProfileManager();
