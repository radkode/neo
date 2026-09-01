import { describe, it, expect } from 'vitest';
import { createAgentCommand } from '@/commands/agent/index.js';

function captureHelp(): string {
  const command = createAgentCommand();
  let help = '';
  command.configureOutput({ writeOut: (str: string) => (help += str) });
  command.outputHelp();
  return help;
}

describe('createAgentCommand', () => {
  it('names and describes the agent command', () => {
    const command = createAgentCommand();

    expect(command.name()).toBe('agent');
    expect(command.description()).toBe('Manage AI agent context and configuration');
  });

  it('registers the init and context subcommands', () => {
    const command = createAgentCommand();
    const subcommands = command.commands;

    expect(subcommands.map((child) => child.name())).toEqual(['init', 'context']);
    expect(subcommands.map((child) => child.description())).toEqual([
      'Initialize agent context management in the current project',
      'Manage agent contexts',
    ]);
  });

  it('lists both subcommands in its help output', () => {
    const help = captureHelp();

    expect(help).toContain('Usage: agent [options] [command]');
    expect(help).toContain('init [options]');
    expect(help).toContain('context');
  });

  it('appends the agent-friendly json examples after the help text', () => {
    const help = captureHelp();

    expect(help).toContain('Agent-friendly usage:');
    expect(help).toContain('$ neo agent context list --json');
    expect(help).toContain('$ neo agent context add "Important fact" --tag important --json');
    expect(help).toContain('$ neo agent context remove <id> --yes --json');
  });
});
