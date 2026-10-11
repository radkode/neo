import { access, lstat, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join, dirname, basename } from 'path';
import { execa } from 'execa';
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
 * Context store file name (JSON-backed; see src/storage/db.ts).
 */
const DB_FILE = 'contexts.json';

/**
 * Find the Git root containing the project's .neo directory
 */
export async function getProjectRoot(): Promise<string | null> {
  let root: string;
  try {
    const result = await execa('git', [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
      '--show-toplevel',
    ]);
    const [commonDir, currentRoot] = result.stdout.trim().split(/\r?\n/);
    if (!commonDir || !currentRoot) return null;
    root = basename(commonDir) === '.git' ? dirname(commonDir) : currentRoot;
  } catch {
    return null;
  }
  if (!root || !(await safeDirectoryExists(join(root, '.neo')))) return null;
  return root;
}

async function safeDirectoryExists(path: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isDirectory()) {
      throw new Error(`Unsafe agent directory: ${path}`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Get the .neo/agent directory path
 */
export async function getAgentDir(): Promise<string | null> {
  const projectRoot = await getProjectRoot();
  if (!projectRoot) {
    return null;
  }
  const agentDir = join(projectRoot, '.neo', AGENT_DIR);
  await safeDirectoryExists(agentDir);
  return agentDir;
}

/**
 * Get the agent database path
 */
export async function getAgentDbPath(): Promise<string | null> {
  const agentDir = await getAgentDir();
  if (!agentDir) {
    return null;
  }
  const dbPath = join(agentDir, DB_FILE);
  try {
    if (!(await lstat(dbPath)).isFile()) {
      throw new Error(`Unsafe context file: ${dbPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return dbPath;
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
    throw new Error('Agent not initialized in this project. Run: neo agent init');
  }
}

/**
 * Create agent directory structure
 */
export async function createAgentDir(): Promise<string> {
  const projectRoot = await getProjectRoot();
  if (!projectRoot) {
    throw new Error('Not in a Neo project. Run: neo init');
  }

  const neoDir = join(projectRoot, '.neo');
  const agentDir = join(neoDir, AGENT_DIR);

  if (!(await safeDirectoryExists(neoDir))) {
    throw new Error(`Unsafe agent directory: ${neoDir}`);
  }
  try {
    await mkdir(agentDir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  if (!(await safeDirectoryExists(agentDir))) {
    throw new Error(`Unsafe agent directory: ${agentDir}`);
  }

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
    throw new Error('Agent directory not found');
  }

  const rawConfig: RawAgentConfig = {
    ...config,
    created_at: config.created_at.toISOString(),
  };

  try {
    await writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to save agent configuration: ${msg}`, { cause: error });
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
