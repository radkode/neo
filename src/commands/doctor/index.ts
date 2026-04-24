import { Command } from '@commander-js/extra-typings';
import { execa } from 'execa';
import which from 'which';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { findUp } from 'find-up';
import { ui } from '@/utils/ui.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
import { configManager } from '@/utils/config.js';
import { secretsManager } from '@/utils/secrets.js';

const FALLBACK_MIN_NODE = '20.0.0';

type CheckStatus = 'ok' | 'warn' | 'fail';

interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  suggestion?: string;
}

interface DoctorResult {
  ok: boolean;
  checks: CheckResult[];
}

/** Parse semver-ish `a.b.c` → `[a,b,c]`. Non-numeric segments become 0. */
function parseSemver(version: string): [number, number, number] {
  const cleaned = version.replace(/^[=v]/, '').split(/[-+]/)[0] ?? '';
  const parts = cleaned.split('.').map((n) => Number.parseInt(n, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Compare `a` against `b`. Returns -1, 0, or 1. Good enough for the
 * engines.node ranges we'd realistically encounter (`>=20`, `>=18.17.0`,
 * bare `20.11.1`). Not a full semver parser — extract the first
 * `x.y.z` it finds.
 */
function compareSemver(a: string, b: string): number {
  const [a1, a2, a3] = parseSemver(a);
  const [b1, b2, b3] = parseSemver(b);
  if (a1 !== b1) return a1 < b1 ? -1 : 1;
  if (a2 !== b2) return a2 < b2 ? -1 : 1;
  if (a3 !== b3) return a3 < b3 ? -1 : 1;
  return 0;
}

/**
 * Extract the minimum Node version from an `engines.node` range. Handles
 * the common shapes: `>=20`, `>=20.0.0`, `^20.0.0`, `~20.0.0`, `20.x`,
 * `20.0.0`. Returns null if the range doesn't specify a floor we can
 * reason about.
 */
function extractMinNodeVersion(range: string): string | null {
  const match = range.match(/(\d+(?:\.\d+){0,2})/);
  return match?.[1] ?? null;
}

async function readRepoEnginesNode(cwd: string): Promise<string | null> {
  const pkgPath = await findUp('package.json', { cwd });
  if (!pkgPath) return null;
  try {
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { engines?: { node?: string } };
    return pkg.engines?.node ?? null;
  } catch {
    return null;
  }
}

async function checkNodeVersion(cwd: string): Promise<CheckResult> {
  const current = process.versions.node;
  const enginesRange = await readRepoEnginesNode(cwd);
  const minVersion = enginesRange
    ? (extractMinNodeVersion(enginesRange) ?? FALLBACK_MIN_NODE)
    : FALLBACK_MIN_NODE;
  const source = enginesRange ? `engines.node "${enginesRange}"` : `default >=${FALLBACK_MIN_NODE}`;

  if (compareSemver(current, minVersion) >= 0) {
    return {
      name: 'node',
      status: 'ok',
      message: `Node ${current} satisfies ${source}`,
    };
  }
  return {
    name: 'node',
    status: 'fail',
    message: `Node ${current} is older than ${minVersion} required by ${source}`,
    suggestion: `Upgrade Node to >=${minVersion} (e.g., via nvm, fnm, or volta).`,
  };
}

async function binaryExists(name: string): Promise<boolean> {
  try {
    await which(name);
    return true;
  } catch {
    return false;
  }
}

async function checkPackageManagers(): Promise<CheckResult> {
  const managers = ['pnpm', 'npm', 'yarn', 'bun'];
  const found: string[] = [];
  for (const pm of managers) {
    if (await binaryExists(pm)) found.push(pm);
  }

  if (found.length === 0) {
    return {
      name: 'packageManager',
      status: 'fail',
      message: 'No package manager found on PATH (pnpm/npm/yarn/bun).',
      suggestion: 'Install at least one package manager — pnpm is recommended.',
    };
  }
  return {
    name: 'packageManager',
    status: 'ok',
    message: `Found: ${found.join(', ')}`,
  };
}

async function checkGitIdentity(): Promise<CheckResult> {
  if (!(await binaryExists('git'))) {
    return {
      name: 'gitIdentity',
      status: 'fail',
      message: 'git is not installed.',
      suggestion: 'Install git from https://git-scm.com/downloads.',
    };
  }

  const read = async (key: string): Promise<string> => {
    try {
      const { stdout } = await execa('git', ['config', '--get', key]);
      return stdout.trim();
    } catch {
      return '';
    }
  };

  const [name, email] = await Promise.all([read('user.name'), read('user.email')]);
  const missing: string[] = [];
  if (!name) missing.push('user.name');
  if (!email) missing.push('user.email');

  if (missing.length > 0) {
    return {
      name: 'gitIdentity',
      status: 'warn',
      message: `git is missing ${missing.join(', ')}.`,
      suggestion: `Set with \`git config --global user.name "..."\` and \`git config --global user.email "..."\`.`,
    };
  }
  return {
    name: 'gitIdentity',
    status: 'ok',
    message: `${name} <${email}>`,
  };
}

async function checkGhAuth(): Promise<CheckResult> {
  if (!(await binaryExists('gh'))) {
    return {
      name: 'gh',
      status: 'warn',
      message: 'GitHub CLI (gh) is not installed.',
      suggestion: 'Install from https://cli.github.com — needed for `neo gh` and PR flows.',
    };
  }

  try {
    await execa('gh', ['auth', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] });
    return {
      name: 'gh',
      status: 'ok',
      message: 'gh is installed and authenticated.',
    };
  } catch {
    return {
      name: 'gh',
      status: 'warn',
      message: 'gh is installed but not authenticated.',
      suggestion: 'Run `gh auth login` to authenticate.',
    };
  }
}

async function checkNeoConfig(): Promise<CheckResult> {
  const configFile = configManager.getConfigFile();
  try {
    await access(configFile, constants.F_OK);
  } catch {
    return {
      name: 'neoConfig',
      status: 'warn',
      message: `No config file at ${configFile}.`,
      suggestion: 'Run `neo init` to create one.',
    };
  }

  try {
    const raw = await readFile(configFile, 'utf-8');
    JSON.parse(raw);
    return {
      name: 'neoConfig',
      status: 'ok',
      message: `Config file is valid JSON (${configFile}).`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      name: 'neoConfig',
      status: 'fail',
      message: `Config file is unreadable: ${msg}`,
      suggestion: `Inspect or remove ${configFile} and re-run \`neo init\`.`,
    };
  }
}

async function checkConfigDirWritable(): Promise<CheckResult> {
  const dir = configManager.getConfigDir();
  try {
    await access(dir, constants.W_OK);
    return {
      name: 'configDirWritable',
      status: 'ok',
      message: `${dir} is writable.`,
    };
  } catch {
    // Dir may not exist yet — that's fine, `neo init` will create it.
    try {
      await access(dir, constants.F_OK);
      return {
        name: 'configDirWritable',
        status: 'fail',
        message: `${dir} exists but isn't writable by the current user.`,
        suggestion: `Check permissions on ${dir}.`,
      };
    } catch {
      return {
        name: 'configDirWritable',
        status: 'ok',
        message: `${dir} does not exist yet — will be created by \`neo init\`.`,
      };
    }
  }
}

async function checkAnthropicKey(): Promise<CheckResult> {
  if (process.env['ANTHROPIC_API_KEY']) {
    return {
      name: 'anthropicKey',
      status: 'ok',
      message: 'ANTHROPIC_API_KEY is set in the environment.',
    };
  }

  try {
    const configured = await secretsManager.isConfigured('ai.apiKey');
    if (configured) {
      return {
        name: 'anthropicKey',
        status: 'ok',
        message: 'API key found in secrets store.',
      };
    }
  } catch {
    // Fall through to the warn below.
  }

  return {
    name: 'anthropicKey',
    status: 'warn',
    message: 'No Anthropic API key configured.',
    suggestion: 'Set $ANTHROPIC_API_KEY or run `neo config set ai.apiKey <key>` — required for `neo git commit --ai`.',
  };
}

export async function executeDoctor(cwd: string): Promise<DoctorResult> {
  const checks = await Promise.all([
    checkNodeVersion(cwd),
    checkPackageManagers(),
    checkGitIdentity(),
    checkGhAuth(),
    checkNeoConfig(),
    checkConfigDirWritable(),
    checkAnthropicKey(),
  ]);

  const ok = checks.every((c) => c.status !== 'fail');
  return { ok, checks };
}

function renderText(result: DoctorResult): void {
  ui.newline();
  for (const check of result.checks) {
    const line = `${check.name}: ${check.message}`;
    if (check.status === 'ok') ui.success(line);
    else if (check.status === 'warn') ui.warn(line);
    else ui.error(line);
    if (check.suggestion) ui.muted(`  → ${check.suggestion}`);
  }

  ui.newline();
  const failed = result.checks.filter((c) => c.status === 'fail').length;
  const warned = result.checks.filter((c) => c.status === 'warn').length;
  if (failed === 0 && warned === 0) {
    ui.success('All checks passed.');
  } else if (failed === 0) {
    ui.warn(`${warned} warning(s) — nothing broken, but you may want to address them.`);
  } else {
    ui.error(`${failed} check(s) failed${warned > 0 ? `, ${warned} warning(s)` : ''}.`);
  }
}

export function createDoctorCommand(): Command {
  const command = new Command('doctor');

  command
    .description('Diagnose the local Neo setup — node version, package managers, git/gh, config, and API keys')
    .addHelpText(
      'after',
      `
Examples:
  Run all checks (default):
    $ neo doctor

  Agent-friendly (structured checks + exit code):
    $ neo doctor --json
`
    )
    .action(
      runAction(async () => {
        const result = await executeDoctor(process.cwd());
        emitJson(
          {
            ok: result.ok,
            command: 'doctor',
            checks: result.checks,
          },
          { text: () => renderText(result) }
        );

        if (!result.ok) {
          // Structured payload already emitted — set exit code to signal
          // failure without emitting a second error object.
          process.exitCode = 1;
        }
      })
    );

  return command;
}
