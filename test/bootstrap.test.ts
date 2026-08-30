import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execa } from 'execa';
import ts from 'typescript';
import { createTempDir, type TempDir } from './utils/test-helpers.js';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const bootstrapPath = fileURLToPath(new URL('../bootstrap.sh', import.meta.url));
const importPattern =
  /^import packageJson from '\.\.\/package\.json' (?:assert|with) \{ type: 'json' \};$/m;
const tempDirs: TempDir[] = [];

interface CompiledFixture {
  diagnostics: readonly ts.Diagnostic[];
  outputPath: string;
}

interface BootstrapFixture {
  env: NodeJS.ProcessEnv;
  projectPath: string;
}

async function createBootstrapFixture(pnpmScript: string): Promise<BootstrapFixture> {
  const tempDir = await createTempDir('neo-bootstrap-');
  tempDirs.push(tempDir);

  const fakeBinPath = join(tempDir.path, 'bin');
  const projectPath = join(tempDir.path, 'project with spaces');
  await mkdir(fakeBinPath);
  await mkdir(projectPath);
  const workspaceModulesPath = join(repoRoot, 'node_modules');
  const projectModulesPath = join(projectPath, 'node_modules');
  await mkdir(projectModulesPath);
  for (const entry of await readdir(workspaceModulesPath)) {
    await symlink(join(workspaceModulesPath, entry), join(projectModulesPath, entry));
  }

  const pnpmPath = join(fakeBinPath, 'pnpm');
  await writeFile(pnpmPath, pnpmScript);
  await chmod(pnpmPath, 0o755);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BOOTSTRAP_TSC: join(repoRoot, 'node_modules', '.bin', 'tsc'),
    BOOTSTRAP_VITEST: join(repoRoot, 'node_modules', '.bin', 'vitest'),
    CI: '1',
    GIT_AUTHOR_EMAIL: 'neo@example.com',
    GIT_AUTHOR_NAME: 'Neo Test',
    GIT_COMMITTER_EMAIL: 'neo@example.com',
    GIT_COMMITTER_NAME: 'Neo Test',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    PATH: `${fakeBinPath}${delimiter}${process.env['PATH'] ?? ''}`,
  };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) {
    delete env[name];
  }

  return { env, projectPath };
}

async function runBootstrap(fixture: BootstrapFixture) {
  return execa('bash', [bootstrapPath], {
    cwd: fixture.projectPath,
    env: fixture.env,
    reject: false,
  });
}

async function runGeneratedCli(
  fixture: BootstrapFixture,
  args: string[],
  env: NodeJS.ProcessEnv = fixture.env
) {
  return execa(process.execPath, [join(fixture.projectPath, 'dist', 'cli.js'), ...args], {
    cwd: fixture.projectPath,
    env,
    extendEnv: false,
    reject: false,
  });
}

async function compileGeneratedImport(
  module: ts.ModuleKind,
  moduleResolution: ts.ModuleResolutionKind
): Promise<CompiledFixture> {
  const tempDir = await createTempDir('neo-bootstrap-');
  tempDirs.push(tempDir);

  const sourceDir = join(tempDir.path, 'src');
  const outputDir = join(tempDir.path, 'dist');
  const sourcePath = join(sourceDir, 'cli.ts');
  await mkdir(sourceDir);
  await writeFile(
    join(tempDir.path, 'package.json'),
    JSON.stringify({ name: 'bootstrap-fixture', type: 'module' })
  );

  const bootstrap = await readFile(bootstrapPath, 'utf8');
  const importStatement = bootstrap.match(importPattern)?.[0];
  expect(importStatement).toBeDefined();
  await writeFile(sourcePath, `${importStatement}\n\nconsole.log(packageJson.name);\n`);

  const program = ts.createProgram({
    rootNames: [sourcePath],
    options: {
      module,
      moduleResolution,
      noEmitOnError: true,
      outDir: outputDir,
      resolveJsonModule: true,
      rootDir: sourceDir,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const emitResult = diagnostics.length === 0 ? program.emit() : undefined;

  return {
    diagnostics: [...diagnostics, ...(emitResult?.diagnostics ?? [])],
    outputPath: join(outputDir, 'cli.js'),
  };
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => tempDir.cleanup()));
});

describe('bootstrap scaffold', () => {
  it('requires a Node release that supports import attributes', async () => {
    const bootstrap = await readFile(bootstrapPath, 'utf8');

    expect(bootstrap).toContain('"node": ">=20.10.0"');
  });

  it('generates a JSON import accepted by TypeScript NodeNext', async () => {
    const fixture = await compileGeneratedImport(
      ts.ModuleKind.NodeNext,
      ts.ModuleResolutionKind.NodeNext
    );

    expect(formatDiagnostics(fixture.diagnostics)).toBe('');
  });

  it('generates a JSON import that runs in Node', async () => {
    const fixture = await compileGeneratedImport(
      ts.ModuleKind.ESNext,
      ts.ModuleResolutionKind.Bundler
    );
    expect(formatDiagnostics(fixture.diagnostics)).toBe('');

    const { stdout } = await execa(process.execPath, [fixture.outputPath]);

    expect(stdout).toBe('bootstrap-fixture');
  });
});

describe.skipIf(process.platform === 'win32')('bootstrap execution', () => {
  it('stops when dependency installation fails', async () => {
    const fixture = await createBootstrapFixture(
      "#!/bin/sh\nprintf '%s\\n' 'FAKE_PNPM_FAILURE' >&2\nexit 86\n"
    );

    const result = await runBootstrap(fixture);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).toBe(86);
    expect(result.stderr).toContain('FAKE_PNPM_FAILURE');
    expect(output).not.toContain('Building the project');
    expect(output).not.toContain('Running tests');
    expect(output).not.toContain('Creating initial commit');
    expect(output).not.toContain('SUCCESS!');
  });

  it('generates a buildable CLI with working display options', async () => {
    const fixture = await createBootstrapFixture(`#!/bin/sh
case "$1:$2" in
  add:*) exit 0 ;;
  run:build) exec "$BOOTSTRAP_TSC" -p tsconfig.json ;;
  test:*) exec "$BOOTSTRAP_VITEST" run ;;
  *) exit 64 ;;
esac
`);

    const bootstrap = await runBootstrap(fixture);
    expect(bootstrap.exitCode, `${bootstrap.stdout}\n${bootstrap.stderr}`).toBe(0);
    expect(bootstrap.stdout).toContain('SUCCESS!');

    const { stdout: commitCount } = await execa('git', ['rev-list', '--count', 'HEAD'], {
      cwd: fixture.projectPath,
      env: fixture.env,
    });
    expect(commitCount).toBe('1');
    const { stdout: committedFiles } = await execa(
      'git',
      ['ls-tree', '-r', '--name-only', 'HEAD'],
      {
        cwd: fixture.projectPath,
        env: fixture.env,
      }
    );
    expect(committedFiles).not.toMatch(/(^|\n)node_modules(?:\/|$)/);
    const { stdout: branch } = await execa('git', ['branch', '--show-current'], {
      cwd: fixture.projectPath,
      env: fixture.env,
    });
    expect(branch).toBe('main');

    const consumerPath = join(fixture.projectPath, 'consumer-cli.js');
    await writeFile(
      consumerPath,
      "import './dist/cli.js';\n\nconsole.log('CONSUMER_IMPORT_OK');\n"
    );
    const linkedBinDirectory = join(fixture.projectPath, 'npm bin');
    const linkedBinPath = join(linkedBinDirectory, 'neo');
    await mkdir(linkedBinDirectory);
    await symlink(join(fixture.projectPath, 'bin', 'cli.js'), linkedBinPath);

    const colorEnv: NodeJS.ProcessEnv = { ...fixture.env, FORCE_COLOR: '1' };
    delete colorEnv['NO_COLOR'];
    const [
      normal,
      noColor,
      noBanner,
      version,
      shortVersion,
      help,
      shortHelp,
      binVersion,
      linkedBinVersion,
      consumer,
      stdinConsumer,
    ] = await Promise.all([
      runGeneratedCli(fixture, ['config', 'list'], colorEnv),
      runGeneratedCli(fixture, ['--no-color', 'config', 'list'], colorEnv),
      runGeneratedCli(fixture, ['--no-banner', 'config', 'list'], colorEnv),
      runGeneratedCli(fixture, ['--version'], colorEnv),
      runGeneratedCli(fixture, ['-V'], colorEnv),
      runGeneratedCli(fixture, ['--help'], colorEnv),
      runGeneratedCli(fixture, ['-h'], colorEnv),
      execa(process.execPath, [join(fixture.projectPath, 'bin', 'cli.js'), '--version'], {
        cwd: fixture.projectPath,
        env: colorEnv,
        extendEnv: false,
        reject: false,
      }),
      execa(linkedBinPath, ['--version'], {
        cwd: fixture.projectPath,
        env: colorEnv,
        extendEnv: false,
        reject: false,
      }),
      execa(process.execPath, [consumerPath, '--version'], {
        cwd: fixture.projectPath,
        env: colorEnv,
        extendEnv: false,
        reject: false,
      }),
      execa(process.execPath, ['--input-type=module', '-'], {
        cwd: fixture.projectPath,
        env: colorEnv,
        extendEnv: false,
        input: "await import('./dist/cli.js');\nconsole.log('STDIN_IMPORT_OK');\n",
        reject: false,
      }),
    ]);

    expect(normal.exitCode).toBe(0);
    expect(normal.stdout).toContain('NEO CLI');
    expect(normal.stdout).toContain('\u001B[');
    expect(noColor.exitCode).toBe(0);
    expect(noColor.stdout).toContain('NEO CLI');
    expect(noColor.stdout).not.toContain('\u001B[');
    expect(noBanner.exitCode).toBe(0);
    expect(noBanner.stdout).not.toContain('NEO CLI');

    for (const result of [version, shortVersion]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('0.1.0');
      expect(result.stderr).toBe('');
    }
    expect(binVersion.exitCode).toBe(0);
    expect(binVersion.stdout).toBe('0.1.0');
    expect(binVersion.stderr).toBe('');
    expect(linkedBinVersion.exitCode).toBe(0);
    expect(linkedBinVersion.stdout).toBe('0.1.0');
    expect(linkedBinVersion.stderr).toBe('');
    expect(consumer.exitCode).toBe(0);
    expect(consumer.stdout).toBe('CONSUMER_IMPORT_OK');
    expect(consumer.stderr).toBe('');
    expect(stdinConsumer.exitCode).toBe(0);
    expect(stdinConsumer.stdout).toBe('STDIN_IMPORT_OK');
    expect(stdinConsumer.stderr).toBe('');
    for (const result of [help, shortHelp]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: neo');
      expect(result.stdout).not.toContain('NEO CLI');
      expect(result.stderr).toBe('');
    }

    const rejectionPreloadPath = join(fixture.projectPath, '..', 'reject-timeout.mjs');
    await writeFile(
      rejectionPreloadPath,
      "globalThis.setTimeout = () => { throw new Error('ASYNC_ACTION_FAILURE'); };\n"
    );
    const rejectionEnv: NodeJS.ProcessEnv = { ...fixture.env, NO_COLOR: '1' };
    delete rejectionEnv['FORCE_COLOR'];
    const rejectedAction = await execa(
      process.execPath,
      [
        '--import',
        pathToFileURL(rejectionPreloadPath).href,
        join(fixture.projectPath, 'dist', 'cli.js'),
        '--no-color',
        '--no-banner',
        'deploy',
        'production',
        '--skip-build',
      ],
      {
        cwd: fixture.projectPath,
        env: rejectionEnv,
        extendEnv: false,
        reject: false,
      }
    );
    expect(rejectedAction.exitCode).toBe(1);
    expect(rejectedAction.stderr).toContain('✖ ASYNC_ACTION_FAILURE');
  }, 30_000);
});
