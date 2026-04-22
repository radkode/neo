import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@inquirer/select', () => ({
  default: vi.fn(),
}));

import selectPrompt from '@inquirer/select';
import {
  NonInteractiveError,
  promptSelect,
  mayPrompt,
  promptGate,
} from '@/utils/prompt.js';
import {
  buildRuntimeContext,
  setRuntimeContext,
} from '@/utils/runtime-context.js';

const selectMock = vi.mocked(selectPrompt);

describe('NonInteractiveError', () => {
  it('carries a stable code and embeds the prompt + flag hint', () => {
    const err = new NonInteractiveError('confirm delete', '--yes');
    expect(err.code).toBe('NEO_NON_INTERACTIVE');
    expect(err.prompt).toBe('confirm delete');
    expect(err.flag).toBe('--yes');
    expect(err.message).toContain('confirm delete');
    expect(err.message).toContain('--yes');
    expect(err.name).toBe('NonInteractiveError');
  });

  it('omits the flag suffix when no flag provided', () => {
    const err = new NonInteractiveError('some prompt');
    expect(err.flag).toBeUndefined();
    expect(err.message).not.toContain('Pass ');
  });
});

describe('promptSelect', () => {
  const choices = [
    { label: 'A', value: 'a' as const },
    { label: 'B', value: 'b' as const },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    setRuntimeContext(buildRuntimeContext({ json: false, yes: false, nonInteractive: false }));
  });

  afterEach(() => {
    setRuntimeContext(buildRuntimeContext());
  });

  it('returns default when --yes is active', async () => {
    setRuntimeContext(buildRuntimeContext({ yes: true }));
    const result = await promptSelect({
      choices,
      defaultValue: 'b',
      message: 'pick',
    });
    expect(result).toBe('b');
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('throws NonInteractiveError in non-interactive mode without safe default', async () => {
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));
    await expect(
      promptSelect({ choices, defaultValue: 'a', message: 'pick', flag: '--choice' })
    ).rejects.toBeInstanceOf(NonInteractiveError);
  });

  it('returns safe default in non-interactive mode when allowed', async () => {
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));
    const result = await promptSelect({
      choices,
      defaultValue: 'a',
      message: 'pick',
      safeDefaultForNonInteractive: true,
    });
    expect(result).toBe('a');
  });

  it('throws when given no choices', async () => {
    await expect(
      promptSelect({ choices: [], message: 'pick' })
    ).rejects.toThrow('No choices provided');
  });

  it('attaches flag hint to NonInteractiveError for agent discoverability', async () => {
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));
    const err = await promptSelect({
      choices,
      defaultValue: 'a',
      message: 'pick',
      flag: '--mode <a|b>',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(NonInteractiveError);
    expect((err as NonInteractiveError).flag).toBe('--mode <a|b>');
  });
});

describe('mayPrompt', () => {
  afterEach(() => {
    setRuntimeContext(buildRuntimeContext());
  });

  it('returns true for interactive mode', () => {
    setRuntimeContext(buildRuntimeContext({ yes: false, nonInteractive: false }));
    expect(mayPrompt('something')).toBe(true);
  });

  it('returns false under --yes so the caller accepts default', () => {
    setRuntimeContext(buildRuntimeContext({ yes: true }));
    expect(mayPrompt('something')).toBe(false);
  });

  it('throws NonInteractiveError under --non-interactive', () => {
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));
    expect(() => mayPrompt('something', '--force')).toThrow(NonInteractiveError);
  });
});

describe('promptGate', () => {
  afterEach(() => {
    setRuntimeContext(buildRuntimeContext());
  });

  it('interactive: shouldPrompt=true, acceptDefault=false', () => {
    setRuntimeContext(buildRuntimeContext({ yes: false, nonInteractive: false }));
    expect(promptGate()).toEqual({ shouldPrompt: true, acceptDefault: false });
  });

  it('--yes: shouldPrompt=false, acceptDefault=true', () => {
    setRuntimeContext(buildRuntimeContext({ yes: true }));
    expect(promptGate()).toEqual({ shouldPrompt: false, acceptDefault: true });
  });

  it('--non-interactive: shouldPrompt=false, acceptDefault=true', () => {
    setRuntimeContext(buildRuntimeContext({ nonInteractive: true }));
    expect(promptGate()).toEqual({ shouldPrompt: false, acceptDefault: true });
  });
});
