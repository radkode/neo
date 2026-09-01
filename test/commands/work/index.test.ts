import type { Command } from '@commander-js/extra-typings';
import { describe, expect, it, vi } from 'vitest';
import { createWorkCommand } from '@/commands/work/index.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

vi.mock('@/utils/ui.js', async () => {
  const { createUiMock } = await import('../../utils/test-helpers.js');
  return { ui: createUiMock() };
});

function renderHelp(command: Command): string {
  let help = '';
  command.configureOutput({
    writeOut: (str) => {
      help += str;
    },
  });
  command.outputHelp();
  return help;
}

describe('createWorkCommand', () => {
  it('is named work and describes the start/ship/finish workflow', () => {
    const command = createWorkCommand();

    expect(command.name()).toBe('work');
    expect(command.description()).toBe(
      'Workflow commands: start, ship, and finish a piece of work'
    );
  });

  it('registers start, ship and finish in workflow order', () => {
    const command = createWorkCommand();

    expect(command.commands.map((child) => child.name())).toEqual(['start', 'ship', 'finish']);
  });

  it('wires the real leaf commands, not placeholders', () => {
    const command = createWorkCommand();

    expect(command.commands.map((child) => [child.name(), child.description()])).toEqual([
      ['start', 'Start a new piece of work: create a prefixed branch (and optionally a worktree)'],
      ['ship', 'Ship the current branch: verify → ensure changeset → push → open PR'],
      [
        'finish',
        'After a PR merges: update the base, delete the local branch, remove any worktree',
      ],
    ]);
  });

  it('carries each leaf command argument through to the parent', () => {
    const command = createWorkCommand();
    const named = (name: string) => command.commands.find((child) => child.name() === name);

    expect(named('start')?.registeredArguments.map((arg) => arg.name())).toEqual(['name']);
    expect(named('ship')?.registeredArguments).toEqual([]);
    expect(named('finish')?.registeredArguments.map((arg) => arg.name())).toEqual(['branch']);
  });

  it('prints the subcommand summary block in --help', () => {
    const help = renderHelp(createWorkCommand());

    expect(help).toContain('Subcommands:');
    expect(help).toContain(
      'start <name>    Create a new prefixed branch (optionally in a worktree)'
    );
    expect(help).toContain(
      'ship            Verify + ensure changeset + push + open PR for the current branch'
    );
    expect(help).toContain(
      'finish [branch] After merge: update base, delete the local branch + worktree'
    );
  });

  it('prints examples written in the neo work form', () => {
    const help = renderHelp(createWorkCommand());

    expect(help).toContain('Examples:');
    expect(help).toContain('$ neo work start fix-login-redirect\n');
    expect(help).toContain('$ neo work start fix-login-redirect --worktree');
    expect(help).toContain('$ neo work ship');
    expect(help).toContain('$ neo work finish');
  });
});
