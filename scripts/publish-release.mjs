import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function publishRelease() {
  const repository = process.env.GITHUB_REPOSITORY;
  const commit = process.env.GITHUB_SHA;
  const token = process.env.GH_TOKEN;
  if (!repository || !commit || !token) {
    throw new Error('GITHUB_REPOSITORY, GITHUB_SHA, and GH_TOKEN are required.');
  }

  const { name, version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  const published = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  );
  if (published.status === 404) {
    execFileSync('npm', ['publish', '--access', 'public'], { stdio: 'inherit' });
  } else {
    if (!published.ok) {
      throw new Error(`Could not check npm publication: HTTP ${published.status}`);
    }
    const metadata = await published.json();
    if (metadata.gitHead !== commit) {
      console.log(
        `Version ${version} was published by another commit; skipping historical release.`
      );
      return;
    }
  }

  const tag = `v${version}`;
  const release = await fetch(
    `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  if (release.ok) {
    console.log(`GitHub release ${tag} already exists.`);
    return;
  }
  if (release.status !== 404) {
    throw new Error(`Could not check GitHub release: HTTP ${release.status}`);
  }

  execFileSync(
    'gh',
    [
      'release',
      'create',
      tag,
      '--repo',
      repository,
      '--target',
      commit,
      '--title',
      tag,
      '--generate-notes',
    ],
    { stdio: 'inherit' }
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishRelease().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
