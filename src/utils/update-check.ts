import packageJson from '../../package.json' with { type: 'json' };
import { configManager } from '@/utils/config.js';
import { logger } from '@/utils/logger.js';
import { ui } from '@/utils/ui.js';

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 24;
const UPDATE_COMMAND = 'npm install -g @radkode/neo@latest';
const UPDATE_PACKAGE_NAME = '@radkode/neo';

export interface UpdateCheckResult {
  checkedAt: string | null;
  currentVersion: string;
  hasUpdate: boolean;
  latestVersion: string | null;
}

/**
 * Compare semantic version strings.
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
}

/**
 * Fetch the latest CLI version from npm.
 */
export async function fetchLatestCliVersion(): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${UPDATE_PACKAGE_NAME}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = (await response.json()) as {
    'dist-tags': { latest: string };
  };

  return data['dist-tags'].latest;
}

/**
 * Perform a periodic update check and persist the result.
 */
export async function checkForCliUpdates(): Promise<UpdateCheckResult> {
  const config = await configManager.read();
  const now = Date.now();
  const lastCheckedAt = config.updates.lastCheckedAt;
  const lastCheckedTime = lastCheckedAt ? Date.parse(lastCheckedAt) : NaN;
  const shouldCheck =
    Number.isNaN(lastCheckedTime) || now - lastCheckedTime > UPDATE_CHECK_INTERVAL_MS;

  let latestVersion = config.updates.latestVersion;
  let checkedAt = lastCheckedAt;

  if (shouldCheck) {
    checkedAt = new Date(now).toISOString();

    try {
      latestVersion = await fetchLatestCliVersion();
    } catch (error) {
      logger.debug(`Update check failed: ${error}`);
    }

    try {
      await configManager.update({
        updates: {
          lastCheckedAt: checkedAt,
          latestVersion,
        },
      });
    } catch (error) {
      logger.debug(`Failed to persist update check result: ${error}`);
    }
  }

  const currentVersion = packageJson.version;
  const hasUpdate = Boolean(latestVersion && compareVersions(latestVersion, currentVersion) > 0);

  return {
    checkedAt: checkedAt ?? null,
    currentVersion,
    hasUpdate,
    latestVersion: latestVersion ?? null,
  };
}

/**
 * Notify the user if an update is available.
 */
export async function notifyIfCliUpdateAvailable(): Promise<void> {
  try {
    const result = await checkForCliUpdates();

    if (!result.hasUpdate || !result.latestVersion) {
      return;
    }

    ui.warn(
      `Neo CLI update available: ${result.currentVersion} → ${result.latestVersion} (run: ${UPDATE_COMMAND})`
    );
    ui.muted('Run the command above to upgrade to the latest version.');
  } catch (error) {
    logger.debug(`Failed to notify about updates: ${error}`);
  }
}
