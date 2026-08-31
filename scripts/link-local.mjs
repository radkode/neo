import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function runPnpm(args, stdio) {
  const npmExecPath = process.env['npm_config_user_agent']?.startsWith('pnpm/')
    ? process.env['npm_execpath']
    : undefined;
  const command = npmExecPath ? process.execPath : 'pnpm';
  const commandArgs = npmExecPath ? [npmExecPath, ...args] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio });
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      const result = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
      reject(new Error(`pnpm ${args.join(' ')} exited with ${result}`));
    });
  });
}

async function readLockOwner(lockDir) {
  try {
    const owner = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
    if (
      !Number.isInteger(owner.pid) ||
      owner.pid <= 0 ||
      typeof owner.token !== 'string' ||
      owner.token.length === 0
    ) {
      return undefined;
    }
    return owner;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function recoverDeadLock(packageDir, lockDir) {
  const owner = await readLockOwner(lockDir);
  if (!owner || isProcessRunning(owner.pid)) {
    return false;
  }

  const abandonedDir = join(packageDir, `.lock-abandoned-${owner.token}`);
  try {
    await rename(lockDir, abandonedDir);
    return true;
  } catch (error) {
    if ((await pathExists(abandonedDir)) || !(await pathExists(lockDir))) {
      return false;
    }
    throw error;
  }
}

async function acquireLock(packageDir) {
  const lockDir = join(packageDir, '.lock');
  const token = randomUUID();
  const candidateDir = join(packageDir, `.lock-candidate-${token}`);
  await mkdir(candidateDir);
  try {
    await writeFile(join(candidateDir, 'owner.json'), JSON.stringify({ pid: process.pid, token }));
  } catch (error) {
    await rm(candidateDir, { recursive: true, force: true });
    throw error;
  }

  const waitUntil = Date.now() + 30_000;
  let acquired = false;

  try {
    while (true) {
      try {
        await rename(candidateDir, lockDir);
        acquired = true;
        return { lockDir, token };
      } catch (error) {
        if (
          !(await pathExists(lockDir)) &&
          !['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error?.code)
        ) {
          throw error;
        }
      }

      if (await recoverDeadLock(packageDir, lockDir)) {
        continue;
      }

      if (Date.now() >= waitUntil) {
        throw new Error(`Another link-local install holds ${lockDir}`);
      }
      await delay(100);
    }
  } finally {
    if (!acquired) {
      await rm(candidateDir, { recursive: true, force: true });
    }
  }
}

async function releaseLock(lockDir, token) {
  const owner = await readLockOwner(lockDir);
  if (owner?.token === token) {
    await rm(lockDir, { recursive: true, force: true });
  }
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
  throw new Error('package.json must define a package name');
}

const globalRootOutput = await runPnpm(['root', '--global'], ['ignore', 'pipe', 'inherit']);
const globalRoot = globalRootOutput.split(/\r?\n/).at(-1);
if (!globalRoot) {
  throw new Error('pnpm did not report its global directory');
}

const globalProjectDir = basename(globalRoot) === 'node_modules' ? dirname(globalRoot) : globalRoot;
const packageDir = join(
  dirname(globalProjectDir),
  '.link-local-packages',
  encodeURIComponent(packageJson.name)
);
await mkdir(packageDir, { recursive: true });
const { lockDir, token: lockToken } = await acquireLock(packageDir);

let archiveDir;
let installed = false;

try {
  archiveDir = await mkdtemp(join(packageDir, 'package-'));
  await runPnpm(['pack', '--pack-destination', archiveDir], ['ignore', 'ignore', 'inherit']);
  const archives = (await readdir(archiveDir)).filter((entry) => entry.endsWith('.tgz'));
  if (archives.length !== 1) {
    throw new Error(`pnpm pack created ${archives.length} archives`);
  }

  const archivePath = join(archiveDir, archives[0]);
  await runPnpm(['add', '--global', `${packageJson.name}@file:${archivePath}`], 'inherit');
  installed = true;

  const previousArchives = (await readdir(packageDir, { withFileTypes: true })).filter(
    (entry) =>
      entry.isDirectory() &&
      entry.name.startsWith('package-') &&
      entry.name !== basename(archiveDir)
  );
  await Promise.all(
    previousArchives.map((entry) =>
      rm(join(packageDir, entry.name), { recursive: true, force: true })
    )
  );
} finally {
  try {
    if (archiveDir && !installed) {
      await rm(archiveDir, { recursive: true, force: true });
    }
  } finally {
    await releaseLock(lockDir, lockToken);
  }
}
