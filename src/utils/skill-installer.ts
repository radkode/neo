import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { mkdir, copyFile, readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { logger } from '@/utils/logger.js';

export type SkillInstallStatus = 'installed' | 'updated' | 'unchanged' | 'skipped-divergent';

export interface SkillInstallResult {
  status: SkillInstallStatus;
  source: string;
  destination: string;
}

const SKILL_NAME = 'neo';
const SKILL_REL_PATH = join('skills', SKILL_NAME, 'SKILL.md');

/**
 * Resolve the bundled templates directory. Works in dev (src/utils/...) and
 * after build (dist/utils/...) since both sit two levels under the package
 * root, alongside `templates/`.
 */
function resolveTemplatesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', 'templates');
}

function getClaudeSkillsDir(): string {
  return join(homedir(), '.claude', 'skills');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function filesIdentical(a: string, b: string): Promise<boolean> {
  const [ba, bb] = await Promise.all([readFile(a), readFile(b)]);
  return ba.equals(bb);
}

/**
 * Install the bundled `neo` Claude Code skill into ~/.claude/skills/neo/.
 *
 * - No-op if `~/.claude/` is absent (Claude Code not installed).
 * - Copies if the destination is missing.
 * - Skips and warns if the destination exists but differs, unless `force`.
 */
export async function installClaudeSkill(
  options: { force?: boolean } = {}
): Promise<SkillInstallResult | null> {
  const claudeDir = join(homedir(), '.claude');
  if (!(await fileExists(claudeDir))) {
    logger.debug(`Skipping skill install: ${claudeDir} does not exist`);
    return null;
  }

  const source = join(resolveTemplatesDir(), SKILL_REL_PATH);
  if (!(await fileExists(source))) {
    logger.debug(`Skipping skill install: bundled template missing at ${source}`);
    return null;
  }

  const destDir = join(getClaudeSkillsDir(), SKILL_NAME);
  const destination = join(destDir, 'SKILL.md');

  await mkdir(destDir, { recursive: true });

  if (await fileExists(destination)) {
    if (await filesIdentical(source, destination)) {
      return { status: 'unchanged', source, destination };
    }
    if (!options.force) {
      return { status: 'skipped-divergent', source, destination };
    }
    await copyFile(source, destination);
    return { status: 'updated', source, destination };
  }

  await copyFile(source, destination);
  return { status: 'installed', source, destination };
}
