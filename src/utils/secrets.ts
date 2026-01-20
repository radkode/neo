import { access, chmod, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '@/utils/logger.js';

/**
 * Neo CLI secrets structure
 * Stored separately from config with restricted file permissions
 */
export interface NeoSecrets {
  ai?: {
    apiKey?: string;
  };
}

const DEFAULT_SECRETS: NeoSecrets = {};

/**
 * File permissions for secrets file (owner read/write only)
 */
const SECRETS_FILE_MODE = 0o600;

export class SecretsManager {
  private secretsDir: string;
  private secretsFile: string;

  constructor() {
    this.secretsDir = join(homedir(), '.config', 'neo');
    this.secretsFile = join(this.secretsDir, 'secrets.json');
  }

  /**
   * Ensures the secrets directory exists
   */
  private async ensureSecretsDir(): Promise<void> {
    try {
      await access(this.secretsDir, constants.F_OK);
    } catch {
      await mkdir(this.secretsDir, { recursive: true });
      logger.debug(`Created secrets directory: ${this.secretsDir}`);
    }
  }

  /**
   * Checks if secrets file exists
   */
  async exists(): Promise<boolean> {
    try {
      await access(this.secretsFile, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads the secrets file
   */
  async read(): Promise<NeoSecrets> {
    const fileExists = await this.exists();
    if (!fileExists) {
      return DEFAULT_SECRETS;
    }

    try {
      const content = await readFile(this.secretsFile, 'utf-8');
      const secrets = JSON.parse(content) as NeoSecrets;
      return { ...DEFAULT_SECRETS, ...secrets };
    } catch (error) {
      logger.warn(`Failed to read secrets file: ${error}`);
      return DEFAULT_SECRETS;
    }
  }

  /**
   * Writes the secrets file with restricted permissions
   */
  async write(secrets: NeoSecrets): Promise<void> {
    await this.ensureSecretsDir();

    try {
      const content = JSON.stringify(secrets, null, 2);
      await writeFile(this.secretsFile, content, { encoding: 'utf-8', mode: SECRETS_FILE_MODE });
      // Ensure permissions are set correctly (in case file already existed)
      await chmod(this.secretsFile, SECRETS_FILE_MODE);
      logger.debug(`Secrets saved to: ${this.secretsFile}`);
    } catch (error) {
      logger.error(`Failed to write secrets file: ${error}`);
      throw error;
    }
  }

  /**
   * Updates secrets with partial data
   */
  async update(updates: Partial<NeoSecrets>): Promise<void> {
    const current = await this.read();
    const updated: NeoSecrets = {
      ...current,
      ai: { ...current.ai, ...updates.ai },
    };
    await this.write(updated);
  }

  /**
   * Gets a specific secret by key path (e.g., 'ai.apiKey')
   */
  async getSecret(keyPath: string): Promise<string | undefined> {
    const secrets = await this.read();
    const keys = keyPath.split('.');

    let value: unknown = secrets;
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return typeof value === 'string' ? value : undefined;
  }

  /**
   * Sets a specific secret by key path (e.g., 'ai.apiKey')
   */
  async setSecret(keyPath: string, value: string): Promise<void> {
    const secrets = await this.read();
    const keys = keyPath.split('.');

    // Build nested structure
    let current: Record<string, unknown> = secrets as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    const lastKey = keys[keys.length - 1]!;
    current[lastKey] = value;

    await this.write(secrets);
  }

  /**
   * Deletes a specific secret by key path
   */
  async deleteSecret(keyPath: string): Promise<void> {
    const secrets = await this.read();
    const keys = keyPath.split('.');

    let current: Record<string, unknown> = secrets as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      if (!current[key] || typeof current[key] !== 'object') {
        return; // Path doesn't exist
      }
      current = current[key] as Record<string, unknown>;
    }

    const lastKey = keys[keys.length - 1]!;
    delete current[lastKey];

    await this.write(secrets);
  }

  /**
   * Checks if a secret is configured
   */
  async isConfigured(keyPath: string): Promise<boolean> {
    const value = await this.getSecret(keyPath);
    return value !== undefined && value.length > 0;
  }

  /**
   * Gets the secrets file path
   */
  getSecretsFile(): string {
    return this.secretsFile;
  }

  /**
   * Masks a secret value for display (shows only last 4 chars)
   */
  static maskSecret(value: string): string {
    if (value.length <= 4) {
      return '****';
    }
    return '****' + value.slice(-4);
  }
}

export const secretsManager = new SecretsManager();
