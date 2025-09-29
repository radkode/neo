import { access, readFile, writeFile, copyFile } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logger } from '@/utils/logger.js';
import type { NeoConfig } from '@/utils/config.js';

export interface ShellIntegration {
  hasAlias(alias: string): Promise<boolean>;
  addAlias(alias: string, command: string): Promise<void>;
  removeAlias(alias: string): Promise<void>;
  hasCompletions(): Promise<boolean>;
  addCompletions(completionsPath: string): Promise<void>;
  removeCompletions(): Promise<void>;
  backup(): Promise<string | null>;
}

const NEO_MARKER_START = '# === NEO CLI START ===';
const NEO_MARKER_END = '# === NEO CLI END ===';

export class ZshIntegration implements ShellIntegration {
  private rcFile: string;

  constructor(rcFile?: string) {
    this.rcFile = rcFile || join(homedir(), '.zshrc');
  }

  /**
   * Checks if .zshrc file exists
   */
  private async rcExists(): Promise<boolean> {
    try {
      await access(this.rcFile, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads the .zshrc file content
   */
  private async readRc(): Promise<string> {
    const exists = await this.rcExists();
    if (!exists) {
      return '';
    }

    try {
      return await readFile(this.rcFile, 'utf-8');
    } catch (error) {
      logger.warn(`Failed to read ${this.rcFile}: ${error}`);
      return '';
    }
  }

  /**
   * Writes content to .zshrc file
   */
  private async writeRc(content: string): Promise<void> {
    try {
      await writeFile(this.rcFile, content, 'utf-8');
      logger.debug(`Updated ${this.rcFile}`);
    } catch (error) {
      logger.error(`Failed to write ${this.rcFile}: ${error}`);
      throw error;
    }
  }

  /**
   * Gets the current NEO CLI section from .zshrc
   */
  private extractNeoSection(content: string): string | null {
    const startIndex = content.indexOf(NEO_MARKER_START);
    const endIndex = content.indexOf(NEO_MARKER_END);

    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
      return null;
    }

    return content.substring(startIndex, endIndex + NEO_MARKER_END.length);
  }

  /**
   * Removes the current NEO CLI section from .zshrc
   */
  private removeNeoSection(content: string): string {
    const neoSection = this.extractNeoSection(content);
    if (!neoSection) {
      return content;
    }

    return content.replace(neoSection, '').replace(/\n\n\n+/g, '\n\n');
  }

  /**
   * Adds or updates the NEO CLI section in .zshrc
   */
  private async updateNeoSection(neoContent: string): Promise<void> {
    const currentContent = await this.readRc();
    const contentWithoutNeo = this.removeNeoSection(currentContent);

    const newNeoSection = `
${NEO_MARKER_START}
${neoContent}
${NEO_MARKER_END}
`;

    const updatedContent = contentWithoutNeo + newNeoSection;
    await this.writeRc(updatedContent);
  }

  /**
   * Checks if a specific alias exists in the NEO section
   */
  async hasAlias(alias: string): Promise<boolean> {
    const content = await this.readRc();
    const neoSection = this.extractNeoSection(content);

    if (!neoSection) {
      return false;
    }

    const aliasPattern = new RegExp(`^alias ${alias}=`, 'm');
    return aliasPattern.test(neoSection);
  }

  /**
   * Adds an alias to the NEO section
   */
  async addAlias(alias: string, command: string): Promise<void> {
    const content = await this.readRc();
    const existingSection = this.extractNeoSection(content);

    let neoContent = '';
    if (existingSection) {
      // Remove existing alias if it exists and add the new one
      const lines = existingSection
        .split('\n')
        .filter(
          (line) =>
            !line.trim().startsWith(NEO_MARKER_START) && !line.trim().startsWith(NEO_MARKER_END)
        )
        .filter((line) => !line.trim().startsWith(`alias ${alias}=`))
        .filter((line) => line.trim() !== '');

      neoContent = lines.join('\n');
    }

    neoContent += neoContent ? '\n' : '';
    neoContent += `alias ${alias}="${command}"`;

    await this.updateNeoSection(neoContent);
    logger.debug(`Added alias: ${alias}="${command}"`);
  }

  /**
   * Removes an alias from the NEO section
   */
  async removeAlias(alias: string): Promise<void> {
    const content = await this.readRc();
    const existingSection = this.extractNeoSection(content);

    if (!existingSection) {
      return;
    }

    const lines = existingSection
      .split('\n')
      .filter(
        (line) =>
          !line.trim().startsWith(NEO_MARKER_START) && !line.trim().startsWith(NEO_MARKER_END)
      )
      .filter((line) => !line.trim().startsWith(`alias ${alias}=`))
      .filter((line) => line.trim() !== '');

    if (lines.length === 0) {
      // Remove entire NEO section if no content left
      const contentWithoutNeo = this.removeNeoSection(content);
      await this.writeRc(contentWithoutNeo);
    } else {
      const neoContent = lines.join('\n');
      await this.updateNeoSection(neoContent);
    }

    logger.debug(`Removed alias: ${alias}`);
  }

  /**
   * Checks if NEO completions are set up
   */
  async hasCompletions(): Promise<boolean> {
    const content = await this.readRc();
    const neoSection = this.extractNeoSection(content);

    if (!neoSection) {
      return false;
    }

    return neoSection.includes('fpath=') && neoSection.includes('compinit');
  }

  /**
   * Adds completion setup to the NEO section
   */
  async addCompletions(completionsPath: string): Promise<void> {
    const content = await this.readRc();
    const existingSection = this.extractNeoSection(content);

    let neoContent = '';
    if (existingSection) {
      const lines = existingSection
        .split('\n')
        .filter(
          (line) =>
            !line.trim().startsWith(NEO_MARKER_START) && !line.trim().startsWith(NEO_MARKER_END)
        )
        .filter((line) => !line.trim().startsWith('fpath='))
        .filter((line) => !line.trim().startsWith('autoload'))
        .filter((line) => line.trim() !== '');

      neoContent = lines.join('\n');
    }

    if (neoContent) {
      neoContent += '\n';
    }

    neoContent += `# Neo CLI completions
fpath=(${completionsPath} $fpath)
autoload -Uz compinit
compinit`;

    await this.updateNeoSection(neoContent);
    logger.debug(`Added completions from: ${completionsPath}`);
  }

  /**
   * Removes completion setup from the NEO section
   */
  async removeCompletions(): Promise<void> {
    const content = await this.readRc();
    const existingSection = this.extractNeoSection(content);

    if (!existingSection) {
      return;
    }

    const lines = existingSection
      .split('\n')
      .filter(
        (line) =>
          !line.trim().startsWith(NEO_MARKER_START) && !line.trim().startsWith(NEO_MARKER_END)
      )
      .filter((line) => !line.trim().startsWith('fpath='))
      .filter((line) => !line.trim().startsWith('autoload'))
      .filter((line) => !line.includes('Neo CLI completions'))
      .filter((line) => !line.trim().startsWith('compinit'))
      .filter((line) => line.trim() !== '');

    if (lines.length === 0) {
      // Remove entire NEO section if no content left
      const contentWithoutNeo = this.removeNeoSection(content);
      await this.writeRc(contentWithoutNeo);
    } else {
      const neoContent = lines.join('\n');
      await this.updateNeoSection(neoContent);
    }

    logger.debug('Removed completions setup');
  }

  /**
   * Creates a backup of the current .zshrc file
   */
  async backup(): Promise<string | null> {
    const exists = await this.rcExists();
    if (!exists) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = `${this.rcFile}.neo-backup.${timestamp}`;

    try {
      await copyFile(this.rcFile, backupFile);
      logger.debug(`Backed up ${this.rcFile} to: ${backupFile}`);
      return backupFile;
    } catch (error) {
      logger.warn(`Failed to backup ${this.rcFile}: ${error}`);
      return null;
    }
  }

  /**
   * Applies shell configuration based on neo config
   */
  async applyConfig(config: NeoConfig): Promise<void> {
    // Add aliases
    if (config.preferences.aliases.n) {
      await this.addAlias('n', 'neo');
    } else {
      await this.removeAlias('n');
    }

    // Add completions if path is configured
    if (config.installation.completionsPath) {
      await this.addCompletions(config.installation.completionsPath);
    }
  }

  /**
   * Removes all neo-related configurations from shell
   */
  async cleanup(): Promise<void> {
    const content = await this.readRc();
    const contentWithoutNeo = this.removeNeoSection(content);

    if (content !== contentWithoutNeo) {
      await this.writeRc(contentWithoutNeo);
      logger.debug('Removed all NEO CLI configurations from shell');
    }
  }

  /**
   * Gets the shell RC file path
   */
  getRcFile(): string {
    return this.rcFile;
  }
}
