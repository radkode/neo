import type { Command } from '@commander-js/extra-typings';
import { createScopedEnvCommand } from '@/utils/scoped-env-command.js';

export function createYarnCommand(): Command {
  return createScopedEnvCommand({ tool: 'yarn', example: 'install --immutable' });
}
