import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join, dirname, basename } from 'path';
import { findUp } from 'find-up';
import type { AgentConfig, RawAgentConfig } from '@/types/agent.js';
import { ui } from '@/utils/ui.js';

/**
 * Agent directory name within .neo
 */
const AGENT_DIR = 'agent';

/**
 * Configuration file name
 */
const CONFIG_FILE = 'config.json';

/**
 * Database file name
 */
const DB_FILE = 'context.db';

/**
 * Find the project root by looking for .neo directory
 */
export async function getProjectRoot(): Promise<string | null> {
  const neoDir = await findUp('.neo', { type: 'directory' });
  return neoDir ? dirname(neoDir) : null;
}

/**
 * Get the .neo/agent directory path
 */
export async function getAgentDir(): Promise<string | null> {
  const projectRoot = await getProjectRoot();
  if (!projectRoot) {
    return null;
  }
  return join(projectRoot, '.neo', AGENT_DIR);
}

/**
 * Get the agent database path
 */
export async function getAgentDbPath(): Promise<string | null> {
  const agentDir = await getAgentDir();
  if (!agentDir) {
    return null;
  }
  return join(agentDir, DB_FILE);
}

/**
 * Get the agent config file path
 */
export async function getAgentConfigPath(): Promise<string | null> {
  const agentDir = await getAgentDir();
  if (!agentDir) {
    return null;
  }
  return join(agentDir, CONFIG_FILE);
}

/**
 * Check if agent is initialized in current project
 */
export async function isAgentInitialized(): Promise<boolean> {
  const agentDir = await getAgentDir();
  if (!agentDir) {
    return false;
  }

  const configPath = join(agentDir, CONFIG_FILE);
  const dbPath = join(agentDir, DB_FILE);

  try {
    await access(agentDir, constants.F_OK);
    await access(configPath, constants.F_OK);
    await access(dbPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure agent is initialized, throw helpful error if not
 */
export async function ensureAgentInitialized(): Promise<void> {
  const initialized = await isAgentInitialized();
  if (!initialized) {
    ui.error('Agent not initialized in this project');
    ui.warn('Run: neo agent init');
    process.exit(1);
  }
}

/**
 * Create agent directory structure
 */
export async function createAgentDir(): Promise<string> {
  const projectRoot = await getProjectRoot();
  if (!projectRoot) {
    ui.error('Not in a Neo project');
    ui.warn('Run: neo init');
    process.exit(1);
  }

  const neoDir = join(projectRoot, '.neo');
  const agentDir = join(neoDir, AGENT_DIR);

  // Create directories recursively (idempotent)
  await mkdir(neoDir, { recursive: true });
  await mkdir(agentDir, { recursive: true });

  return agentDir;
}

/**
 * Load agent configuration
 */
export async function loadAgentConfig(): Promise<AgentConfig | null> {
  const configPath = await getAgentConfigPath();
  if (!configPath) {
    return null;
  }

  try {
    await access(configPath, constants.F_OK);
  } catch {
    return null;
  }

  try {
    const raw = await readFile(configPath, 'utf-8');
    const rawConfig = JSON.parse(raw) as RawAgentConfig;
    return {
      ...rawConfig,
      created_at: new Date(rawConfig.created_at),
    };
  } catch (error) {
    ui.error('Failed to load agent configuration');
    ui.muted(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Save agent configuration
 */
export async function saveAgentConfig(config: AgentConfig): Promise<void> {
  const configPath = await getAgentConfigPath();
  if (!configPath) {
    ui.error('Agent directory not found');
    process.exit(1);
  }

  const rawConfig: RawAgentConfig = {
    ...config,
    created_at: config.created_at.toISOString(),
  };

  try {
    await writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');
  } catch (error) {
    ui.error('Failed to save agent configuration');
    ui.muted(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Add .neo/agent to .gitignore if .gitignore exists
 */
export async function updateGitignore(): Promise<void> {
  const projectRoot = await getProjectRoot();
  if (!projectRoot) {
    return;
  }

  const gitignorePath = join(projectRoot, '.gitignore');
  try {
    await access(gitignorePath, constants.F_OK);
  } catch {
    return;
  }

  try {
    const gitignoreContent = await readFile(gitignorePath, 'utf-8');
    const agentIgnoreEntry = '.neo/agent/';

    // Check if already in .gitignore
    if (gitignoreContent.includes(agentIgnoreEntry)) {
      return;
    }

    // Add to .gitignore
    const updatedContent = gitignoreContent.endsWith('\n')
      ? gitignoreContent + agentIgnoreEntry + '\n'
      : gitignoreContent + '\n' + agentIgnoreEntry + '\n';

    await writeFile(gitignorePath, updatedContent, 'utf-8');
    ui.muted('Added .neo/agent/ to .gitignore');
  } catch {
    // Silently fail - not critical
    ui.muted('Could not update .gitignore');
  }
}

/**
 * Get the current working directory name as default project name
 */
export async function getDefaultProjectName(): Promise<string> {
  const projectRoot = await getProjectRoot();
  if (!projectRoot) {
    return 'unknown-project';
  }
  const name = basename(projectRoot);
  return name || 'unknown-project';
}
