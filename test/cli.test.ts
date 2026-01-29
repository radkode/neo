import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';
import { createCLI } from '../src/cli.js';

describe('CLI', () => {
  let program: Command;

  beforeEach(async () => {
    program = await createCLI();
  });

  it('should have the correct name', () => {
    expect(program.name()).toBe('neo');
  });

  it('should have a version', () => {
    expect(program.version()).toBeDefined();
  });

  it('should have verbose option', () => {
    const options = program.options;
    const verboseOption = options.find((opt) => opt.long === '--verbose');
    expect(verboseOption).toBeDefined();
  });

  it('should have init command', () => {
    const commands = program.commands;
    const initCommand = commands.find((cmd) => cmd.name() === 'init');
    expect(initCommand).toBeDefined();
  });

  it('should have config command', () => {
    const commands = program.commands;
    const configCommand = commands.find((cmd) => cmd.name() === 'config');
    expect(configCommand).toBeDefined();
  });
});
