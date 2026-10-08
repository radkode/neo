import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const commit = '0123456789abcdef0123456789abcdef01234567';
let publishRelease: () => Promise<void>;

beforeAll(async () => {
  const script = new URL('../scripts/publish-release.mjs', import.meta.url);
  ({ publishRelease } = await import(script.href));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GITHUB_REPOSITORY', 'radkode/neo');
  vi.stubEnv('GITHUB_SHA', commit);
  vi.stubEnv('GH_TOKEN', 'fixture-token');
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(readFile).mockResolvedValue(JSON.stringify({ name: '@radkode/neo', version: '2.0.0' }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('release publication', () => {
  it('publishes a missing version before creating its tag and GitHub release at the publishing commit', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await publishRelease();
    expect(execFileSync).toHaveBeenNthCalledWith(1, 'npm', ['publish', '--access', 'public'], {
      stdio: 'inherit',
    });
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      'gh',
      [
        'release',
        'create',
        'v2.0.0',
        '--repo',
        'radkode/neo',
        '--target',
        commit,
        '--title',
        'v2.0.0',
        '--generate-notes',
      ],
      { stdio: 'inherit' }
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://registry.npmjs.org/%40radkode%2Fneo/2.0.0');
  });

  it('retries GitHub release creation without republishing a version published by this commit', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ gitHead: commit }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await publishRelease();
    expect(execFileSync).toHaveBeenCalledOnce();
    expect(vi.mocked(execFileSync).mock.calls[0]?.[0]).toBe('gh');
  });

  it('does nothing when the release already exists', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ gitHead: commit }));
    fetchMock.mockResolvedValueOnce(Response.json({ tag_name: 'v2.0.0' }));
    await publishRelease();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('does not backfill or retag a historical version on a later commit', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ gitHead: 'older-commit' }));
    await publishRelease();
    expect(execFileSync).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not backfill versions without publishing-commit metadata', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ version: '2.0.0' }));
    await publishRelease();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('does not publish when the registry returns an unexpected failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(publishRelease()).rejects.toThrow('Could not check npm publication: HTTP 503');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('does not publish when the registry cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(publishRelease()).rejects.toThrow('network unavailable');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('does not create a release when npm publication fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('npm publication failed');
    });
    await expect(publishRelease()).rejects.toThrow('npm publication failed');
    expect(execFileSync).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reports GitHub authentication failures instead of treating them as a missing release', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ gitHead: commit }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(publishRelease()).rejects.toThrow('Could not check GitHub release: HTTP 401');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('propagates release creation failures for a retry on the same commit', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ gitHead: commit }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('release creation failed');
    });
    await expect(publishRelease()).rejects.toThrow('release creation failed');
  });

  it('requires the GitHub context before performing any external action', async () => {
    vi.stubEnv('GH_TOKEN', undefined);
    await expect(publishRelease()).rejects.toThrow(
      'GITHUB_REPOSITORY, GITHUB_SHA, and GH_TOKEN are required'
    );
    expect(execFileSync).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails safely when the actual CLI is run without a GitHub token', async () => {
    const { spawnSync } =
      await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const script = fileURLToPath(new URL('../scripts/publish-release.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, GH_TOKEN: '' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GITHUB_REPOSITORY, GITHUB_SHA, and GH_TOKEN are required.');
    expect(result.stdout).toBe('');
  });

  it('is wired into the trusted-publishing workflow with a scoped GitHub token', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const workflow = await actualFs.readFile(
      new URL('../.github/workflows/release.yml', import.meta.url),
      'utf8'
    );
    expect(workflow).toContain("if: steps.changesets.outputs.pullRequestNumber == ''");
    expect(workflow).toContain('run: node scripts/publish-release.mjs');
    expect(workflow).toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
    expect(workflow).toContain('id-token: write');
  });
});
