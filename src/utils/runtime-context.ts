/**
 * Runtime context for agent/automation-friendly CLI behavior.
 *
 * Holds flags parsed from the root program plus auto-detected environment
 * signals (TTY, CI, known agent env vars). Populated once in the preAction
 * hook and then consulted by logger, prompts, banner, and commands to decide
 * whether to render human-oriented UI or machine-oriented output.
 */

export type OutputFormat = 'text' | 'json';

export interface RuntimeContext {
  /** Output mode: 'text' (human) or 'json' (machine). Controls stdout shape. */
  format: OutputFormat;
  /** Auto-accept prompt defaults instead of asking. */
  yes: boolean;
  /** Fail fast on any prompt rather than blocking on input. */
  nonInteractive: boolean;
  /** Suppress decorative output (spinners, banners, muted info). */
  quiet: boolean;
  /** Verbose/debug logging enabled. */
  verbose: boolean;
  /** Whether color is allowed. Honors --no-color and NO_COLOR. */
  color: boolean;
  /** Whether stdout is attached to a TTY. */
  stdoutIsTTY: boolean;
  /** Whether stdin is attached to a TTY. */
  stdinIsTTY: boolean;
  /** Detected CI environment. */
  isCI: boolean;
  /** Detected AI/agent environment (Claude Code, Cursor, Aider, etc.). */
  isAgent: boolean;
}

function detectCI(): boolean {
  const env = process.env;
  return Boolean(
    env['CI'] ||
      env['CONTINUOUS_INTEGRATION'] ||
      env['GITHUB_ACTIONS'] ||
      env['GITLAB_CI'] ||
      env['CIRCLECI'] ||
      env['BUILDKITE'] ||
      env['JENKINS_URL'] ||
      env['TEAMCITY_VERSION']
  );
}

function detectAgent(): boolean {
  const env = process.env;
  // Known markers set by AI coding tools / agent runtimes.
  return Boolean(
    env['CLAUDECODE'] ||
      env['CLAUDE_CODE'] ||
      env['CURSOR_AGENT'] ||
      env['AIDER'] ||
      env['CODEX_CLI'] ||
      env['NEO_AGENT'] ||
      // Generic opt-in used by agents setting up a shell for a CLI.
      env['AI_AGENT']
  );
}

/**
 * Test runners (vitest/jest) don't have a TTY but mock inquirer explicitly.
 * Without this guard, the TTY-absence heuristic would force non-interactive mode
 * and break any test that expects an interactive prompt.
 */
function isTestEnvironment(): boolean {
  const env = process.env;
  return Boolean(env['VITEST'] || env['JEST_WORKER_ID'] || env['NODE_ENV'] === 'test');
}

function envBool(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  const lower = v.toLowerCase();
  return lower === '1' || lower === 'true' || lower === 'yes';
}

export interface RuntimeContextOverrides {
  json?: boolean;
  format?: OutputFormat;
  yes?: boolean;
  nonInteractive?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
}

/**
 * Build a RuntimeContext from CLI flags + environment auto-detection.
 * Precedence: explicit flags > env vars > auto-detection.
 */
export function buildRuntimeContext(overrides: RuntimeContextOverrides = {}): RuntimeContext {
  const stdoutIsTTY = Boolean(process.stdout.isTTY);
  const stdinIsTTY = Boolean(process.stdin.isTTY);
  const inTest = isTestEnvironment();
  // Test runners set env vars that would otherwise force non-interactive mode.
  // Since tests mock inquirer explicitly, ignore those signals under test.
  const isCI = inTest ? false : detectCI();
  const isAgent = inTest ? false : detectAgent();

  const jsonFromEnv = envBool('NEO_JSON');
  const format: OutputFormat =
    overrides.format ?? (overrides.json || jsonFromEnv ? 'json' : 'text');

  const yes = overrides.yes ?? envBool('NEO_YES');

  // Non-interactive is implied whenever prompts can't possibly succeed.
  // Skip the TTY heuristic inside test runners — they mock inquirer explicitly.
  const nonInteractive =
    overrides.nonInteractive ??
    (envBool('NEO_NON_INTERACTIVE') ||
      isCI ||
      isAgent ||
      format === 'json' ||
      (!stdinIsTTY && !inTest));

  const quiet = overrides.quiet ?? (envBool('NEO_QUIET') || format === 'json');

  const noColorEnv = Boolean(process.env['NO_COLOR']);
  const color = overrides.color ?? !(noColorEnv || !stdoutIsTTY || format === 'json');

  return {
    format,
    yes,
    nonInteractive,
    quiet,
    verbose: overrides.verbose ?? false,
    color,
    stdoutIsTTY,
    stdinIsTTY,
    isCI,
    isAgent,
  };
}

let current: RuntimeContext = buildRuntimeContext();

/** Replace the active runtime context (call once from the root preAction). */
export function setRuntimeContext(ctx: RuntimeContext): void {
  current = ctx;
}

/** Read the active runtime context. */
export function getRuntimeContext(): RuntimeContext {
  return current;
}

/** Shorthand for the most frequently consulted bit. */
export function isJsonMode(): boolean {
  return current.format === 'json';
}
