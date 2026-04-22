import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildRuntimeContext,
  getRuntimeContext,
  isJsonMode,
  setRuntimeContext,
} from '@/utils/runtime-context.js';

const PRESERVED_ENV_KEYS = [
  'CI',
  'CONTINUOUS_INTEGRATION',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'BUILDKITE',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'CLAUDECODE',
  'CLAUDE_CODE',
  'CURSOR_AGENT',
  'AIDER',
  'CODEX_CLI',
  'NEO_AGENT',
  'AI_AGENT',
  'NEO_JSON',
  'NEO_YES',
  'NEO_NON_INTERACTIVE',
  'NEO_QUIET',
  'NO_COLOR',
  'VITEST',
  'JEST_WORKER_ID',
  'NODE_ENV',
] as const;

describe('runtime-context', () => {
  let originalEnv: Record<string, string | undefined>;
  let originalStdoutIsTTY: boolean | undefined;
  let originalStdinIsTTY: boolean | undefined;

  beforeEach(() => {
    originalEnv = {};
    for (const key of PRESERVED_ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Keep VITEST set so the "test environment" guard remains active — otherwise
    // detectCI would trip on CI env vars present in the runner.
    process.env['VITEST'] = originalEnv['VITEST'] ?? 'true';

    originalStdoutIsTTY = process.stdout.isTTY;
    originalStdinIsTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    for (const key of PRESERVED_ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalStdoutIsTTY,
    });
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: originalStdinIsTTY,
    });
  });

  describe('buildRuntimeContext', () => {
    it('defaults to text format when no flags or env vars set', () => {
      const ctx = buildRuntimeContext();
      expect(ctx.format).toBe('text');
      expect(ctx.yes).toBe(false);
      expect(ctx.quiet).toBe(false);
      expect(ctx.verbose).toBe(false);
    });

    it('--json override flips format to json', () => {
      const ctx = buildRuntimeContext({ json: true });
      expect(ctx.format).toBe('json');
    });

    it('NEO_JSON=1 env var flips format to json', () => {
      process.env['NEO_JSON'] = '1';
      const ctx = buildRuntimeContext();
      expect(ctx.format).toBe('json');
    });

    it('--json implies non-interactive and quiet', () => {
      const ctx = buildRuntimeContext({ json: true });
      expect(ctx.nonInteractive).toBe(true);
      expect(ctx.quiet).toBe(true);
    });

    it('--json disables color', () => {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
      const ctx = buildRuntimeContext({ json: true });
      expect(ctx.color).toBe(false);
    });

    it('NEO_YES=true env var enables yes', () => {
      process.env['NEO_YES'] = 'true';
      const ctx = buildRuntimeContext();
      expect(ctx.yes).toBe(true);
    });

    it('explicit yes override wins over env', () => {
      process.env['NEO_YES'] = 'true';
      const ctx = buildRuntimeContext({ yes: false });
      expect(ctx.yes).toBe(false);
    });

    it('NEO_NON_INTERACTIVE=yes env var enables non-interactive', () => {
      process.env['NEO_NON_INTERACTIVE'] = 'yes';
      const ctx = buildRuntimeContext();
      expect(ctx.nonInteractive).toBe(true);
    });

    it('NO_COLOR disables color', () => {
      process.env['NO_COLOR'] = '1';
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
      const ctx = buildRuntimeContext();
      expect(ctx.color).toBe(false);
    });

    it('non-TTY stdout disables color', () => {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
      const ctx = buildRuntimeContext();
      expect(ctx.color).toBe(false);
    });

    it('TTY stdout keeps color enabled', () => {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
      const ctx = buildRuntimeContext();
      expect(ctx.color).toBe(true);
    });

    it('explicit color:false override wins', () => {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
      const ctx = buildRuntimeContext({ color: false });
      expect(ctx.color).toBe(false);
    });

    it('inside test env, CI vars do not force non-interactive', () => {
      // Simulated CI var; test-env guard should zero it out.
      process.env['CI'] = 'true';
      const ctx = buildRuntimeContext();
      expect(ctx.isCI).toBe(false);
    });

    it('inside test env, agent vars do not force non-interactive', () => {
      process.env['CLAUDECODE'] = '1';
      const ctx = buildRuntimeContext();
      expect(ctx.isAgent).toBe(false);
    });

    it('explicit verbose flag propagates', () => {
      const ctx = buildRuntimeContext({ verbose: true });
      expect(ctx.verbose).toBe(true);
    });

    it('NEO_QUIET=1 env enables quiet', () => {
      process.env['NEO_QUIET'] = '1';
      const ctx = buildRuntimeContext();
      expect(ctx.quiet).toBe(true);
    });

    it('stdoutIsTTY and stdinIsTTY reflect process state', () => {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
      const ctx = buildRuntimeContext();
      expect(ctx.stdoutIsTTY).toBe(true);
      expect(ctx.stdinIsTTY).toBe(false);
    });
  });

  describe('getRuntimeContext / setRuntimeContext', () => {
    it('set and get round-trip', () => {
      const ctx = buildRuntimeContext({ json: true, yes: true });
      setRuntimeContext(ctx);
      expect(getRuntimeContext()).toBe(ctx);
    });

    it('isJsonMode reflects the active context', () => {
      setRuntimeContext(buildRuntimeContext({ json: true }));
      expect(isJsonMode()).toBe(true);
      setRuntimeContext(buildRuntimeContext({ json: false }));
      expect(isJsonMode()).toBe(false);
    });
  });
});
