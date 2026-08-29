import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import ts from 'typescript';
import { createTempDir, type TempDir } from './utils/test-helpers.js';

const bootstrapPath = fileURLToPath(new URL('../bootstrap.sh', import.meta.url));
const importPattern =
  /^import packageJson from '\.\.\/package\.json' (?:assert|with) \{ type: 'json' \};$/m;
const tempDirs: TempDir[] = [];

interface CompiledFixture {
  diagnostics: readonly ts.Diagnostic[];
  outputPath: string;
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
