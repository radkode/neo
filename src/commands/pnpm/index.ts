import type { Command } from '@commander-js/extra-typings';
import { createScopedEnvCommand } from '@/utils/scoped-env-command.js';

export function createPnpmCommand(): Command {
  return createScopedEnvCommand({ tool: 'pnpm', example: 'install --frozen-lockfile' });
}
