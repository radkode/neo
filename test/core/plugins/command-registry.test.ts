import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRegistry } from '../../../src/core/plugins/command-registry.js';
import type { ICommand, CommandMetadata } from '../../../src/core/interfaces/index.js';

// Helper to create mock commands
function createMockCommand(name: string, description = 'Test command'): ICommand {
  return {
    name,
    description,
    execute: async () => {},
  };
}

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  describe('register', () => {
    it('should register a command', () => {
      const command = createMockCommand('test');

      registry.register(command);

      expect(registry.hasCommand('test')).toBe(true);
    });

    it('should register a command with metadata', () => {
      const command = createMockCommand('test');
      const metadata: CommandMetadata = {
        group: 'git',
        aliases: ['t'],
        hidden: false,
      };

      registry.register(command, metadata);

      expect(registry.getMetadata('test')).toEqual(metadata);
    });

    it('should throw error when registering duplicate command', () => {
      const command1 = createMockCommand('test');
      const command2 = createMockCommand('test');

      registry.register(command1);

      expect(() => registry.register(command2)).toThrow(
        'Command "test" is already registered'
      );
    });
  });

  describe('unregister', () => {
    it('should unregister an existing command', () => {
      const command = createMockCommand('test');
      registry.register(command);

      registry.unregister('test');

      expect(registry.hasCommand('test')).toBe(false);
    });

    it('should not throw when unregistering non-existent command', () => {
      expect(() => registry.unregister('non-existent')).not.toThrow();
    });
  });

  describe('get', () => {
    it('should return the command when found', () => {
      const command = createMockCommand('test');
      registry.register(command);

      const result = registry.get('test');

      expect(result).toBe(command);
    });

    it('should return undefined when command not found', () => {
      const result = registry.get('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return empty array when no commands registered', () => {
      const result = registry.getAll();

      expect(result).toEqual([]);
    });

    it('should return all registered commands', () => {
      const command1 = createMockCommand('cmd1');
      const command2 = createMockCommand('cmd2');
      const command3 = createMockCommand('cmd3');

      registry.register(command1);
      registry.register(command2);
      registry.register(command3);

      const result = registry.getAll();

      expect(result).toHaveLength(3);
      expect(result).toContain(command1);
      expect(result).toContain(command2);
      expect(result).toContain(command3);
    });
  });

  describe('getByGroup', () => {
    it('should return empty array when no commands match group', () => {
      const command = createMockCommand('test');
      registry.register(command, { group: 'other' });

      const result = registry.getByGroup('git');

      expect(result).toEqual([]);
    });

    it('should return commands matching the group', () => {
      const gitCmd1 = createMockCommand('commit');
      const gitCmd2 = createMockCommand('push');
      const configCmd = createMockCommand('config');

      registry.register(gitCmd1, { group: 'git' });
      registry.register(gitCmd2, { group: 'git' });
      registry.register(configCmd, { group: 'config' });

      const result = registry.getByGroup('git');

      expect(result).toHaveLength(2);
      expect(result).toContain(gitCmd1);
      expect(result).toContain(gitCmd2);
      expect(result).not.toContain(configCmd);
    });

    it('should not include commands without metadata', () => {
      const withMetadata = createMockCommand('with');
      const withoutMetadata = createMockCommand('without');

      registry.register(withMetadata, { group: 'test' });
      registry.register(withoutMetadata); // No metadata

      const result = registry.getByGroup('test');

      expect(result).toHaveLength(1);
      expect(result).toContain(withMetadata);
    });
  });

  describe('hasCommand', () => {
    it('should return true for registered commands', () => {
      registry.register(createMockCommand('test'));

      expect(registry.hasCommand('test')).toBe(true);
    });

    it('should return false for unregistered commands', () => {
      expect(registry.hasCommand('non-existent')).toBe(false);
    });
  });

  describe('getMetadata', () => {
    it('should return metadata for command with metadata', () => {
      const command = createMockCommand('test');
      const metadata: CommandMetadata = {
        group: 'test-group',
        aliases: ['t', 'tst'],
        hidden: true,
      };

      registry.register(command, metadata);

      expect(registry.getMetadata('test')).toEqual(metadata);
    });

    it('should return undefined for command without metadata', () => {
      registry.register(createMockCommand('test'));

      expect(registry.getMetadata('test')).toBeUndefined();
    });

    it('should return undefined for non-existent command', () => {
      expect(registry.getMetadata('non-existent')).toBeUndefined();
    });
  });

  describe('getNames', () => {
    it('should return empty array when no commands registered', () => {
      expect(registry.getNames()).toEqual([]);
    });

    it('should return all command names', () => {
      registry.register(createMockCommand('alpha'));
      registry.register(createMockCommand('beta'));
      registry.register(createMockCommand('gamma'));

      const names = registry.getNames();

      expect(names).toHaveLength(3);
      expect(names).toContain('alpha');
      expect(names).toContain('beta');
      expect(names).toContain('gamma');
    });
  });

  describe('clear', () => {
    it('should remove all registered commands', () => {
      registry.register(createMockCommand('cmd1'));
      registry.register(createMockCommand('cmd2'));
      registry.register(createMockCommand('cmd3'));

      registry.clear();

      expect(registry.size).toBe(0);
      expect(registry.getAll()).toEqual([]);
    });

    it('should work when already empty', () => {
      expect(() => registry.clear()).not.toThrow();
      expect(registry.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return 0 when empty', () => {
      expect(registry.size).toBe(0);
    });

    it('should return correct count after registrations', () => {
      registry.register(createMockCommand('cmd1'));
      expect(registry.size).toBe(1);

      registry.register(createMockCommand('cmd2'));
      expect(registry.size).toBe(2);

      registry.register(createMockCommand('cmd3'));
      expect(registry.size).toBe(3);
    });

    it('should decrease after unregister', () => {
      registry.register(createMockCommand('cmd1'));
      registry.register(createMockCommand('cmd2'));

      registry.unregister('cmd1');

      expect(registry.size).toBe(1);
    });
  });
});
