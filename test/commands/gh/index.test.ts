import { describe, expect, it } from 'vitest';
import { createGhCommand } from '@/commands/gh/index.js';
import { createPrCommand } from '@/commands/gh/pr/index.js';

describe('createGhCommand', () => {
  it('registers gh with only the pr subcommand', () => {
    const command = createGhCommand();

    expect(command.name()).toBe('gh');
    expect(command.description()).toBe('GitHub CLI operations');
    expect(command.commands.map((child) => child.name())).toEqual(['pr']);
  });

  it('wires the real pr command under gh, not a placeholder', () => {
    const pr = createGhCommand().commands.find((child) => child.name() === 'pr');

    expect(pr?.description()).toBe('Pull request operations');
    expect(pr?.commands.map((child) => child.name())).toEqual(['create', 'merge']);
  });

  it('lists pr in the gh help output', () => {
    expect(createGhCommand().helpInformation()).toMatch(/pr\s+Pull request operations/);
  });
});

describe('createPrCommand', () => {
  it('describes itself as the pull request namespace', () => {
    const command = createPrCommand();

    expect(command.name()).toBe('pr');
    expect(command.description()).toBe('Pull request operations');
  });
});
