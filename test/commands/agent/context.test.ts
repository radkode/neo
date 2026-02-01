import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentContextCommand } from '../../../src/commands/agent/context/index.js';
import { mockProcessExit, createSpinnerMock } from '../../utils/test-helpers.js';

// Mock all dependencies
vi.mock('@/utils/ui.js', () => ({
  ui: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    muted: vi.fn(),
    keyValue: vi.fn(),
    section: vi.fn(),
    divider: vi.fn(),
    table: vi.fn(),
    spinner: vi.fn(() => createSpinnerMock()),
  },
}));

vi.mock('@/utils/agent.js', () => ({
  ensureAgentInitialized: vi.fn(),
  getAgentDbPath: vi.fn(),
}));

vi.mock('@/storage/db.js', () => ({
  ContextDB: {
    create: vi.fn(),
  },
}));

vi.mock('@/utils/validation.js', () => ({
  validate: vi.fn((schema, value) => value),
  validateArgument: vi.fn((schema, value) => value),
  isValidationError: vi.fn().mockReturnValue(false),
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

import { ui } from '@/utils/ui.js';
import { ensureAgentInitialized, getAgentDbPath } from '@/utils/agent.js';
import { ContextDB } from '@/storage/db.js';
import { validateArgument } from '@/utils/validation.js';
import inquirer from 'inquirer';

describe('createAgentContextCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = mockProcessExit();
  });

  afterEach(() => {
    exitMock.mockRestore();
  });

  describe('command structure', () => {
    it('should create context command with correct name', () => {
      const command = createAgentContextCommand();

      expect(command.name()).toBe('context');
    });

    it('should have description', () => {
      const command = createAgentContextCommand();

      expect(command.description()).toBe('Manage agent contexts');
    });

    it('should have add subcommand', () => {
      const command = createAgentContextCommand();
      const subcommands = command.commands.map((c) => c.name());

      expect(subcommands).toContain('add');
    });

    it('should have list subcommand', () => {
      const command = createAgentContextCommand();
      const subcommands = command.commands.map((c) => c.name());

      expect(subcommands).toContain('list');
    });

    it('should have remove subcommand', () => {
      const command = createAgentContextCommand();
      const subcommands = command.commands.map((c) => c.name());

      expect(subcommands).toContain('remove');
    });
  });

  describe('context add', () => {
    it('should add context successfully', async () => {
      const mockDb = {
        addContext: vi.fn().mockReturnValue({
          id: 'ctx-123',
          content: 'Test context',
          tags: ['test'],
          priority: 'medium',
          created_at: new Date('2024-01-01'),
        }),
        close: vi.fn(),
      };
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

      const command = createAgentContextCommand();
      await command.parseAsync(['add', 'Test context', '--tag', 'test'], { from: 'user' });

      expect(ensureAgentInitialized).toHaveBeenCalled();
      expect(mockDb.addContext).toHaveBeenCalledWith({
        content: 'Test context',
        tags: ['test'],
        priority: 'medium',
      });
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should add context with priority', async () => {
      const mockDb = {
        addContext: vi.fn().mockReturnValue({
          id: 'ctx-123',
          content: 'High priority context',
          tags: [],
          priority: 'high',
          created_at: new Date('2024-01-01'),
        }),
        close: vi.fn(),
      };
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

      const command = createAgentContextCommand();
      await command.parseAsync(['add', 'High priority context', '--priority', 'high'], { from: 'user' });

      expect(mockDb.addContext).toHaveBeenCalledWith({
        content: 'High priority context',
        tags: [],
        priority: 'high',
      });
    });

    it('should exit when database path not found', async () => {
      vi.mocked(getAgentDbPath).mockResolvedValue(null);

      const command = createAgentContextCommand();
      await command.parseAsync(['add', 'Test context'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Failed to get database path');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle database error', async () => {
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockRejectedValue(new Error('Database error'));

      const command = createAgentContextCommand();
      await command.parseAsync(['add', 'Test context'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Database error');
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('context list', () => {
    it('should list contexts successfully', async () => {
      const mockContexts = [
        {
          id: 'ctx-123',
          content: 'Test context 1',
          tags: ['test'],
          priority: 'medium',
          created_at: new Date('2024-01-01'),
        },
        {
          id: 'ctx-456',
          content: 'Test context 2',
          tags: [],
          priority: 'high',
          created_at: new Date('2024-01-02'),
        },
      ];
      const mockDb = {
        listContexts: vi.fn().mockReturnValue(mockContexts),
        getStats: vi.fn().mockReturnValue({ total: 2 }),
        close: vi.fn(),
      };
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

      const command = createAgentContextCommand();
      await command.parseAsync(['list'], { from: 'user' });

      expect(ensureAgentInitialized).toHaveBeenCalled();
      expect(mockDb.listContexts).toHaveBeenCalled();
      expect(ui.section).toHaveBeenCalledWith('Agent Contexts');
      expect(ui.table).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should filter by tag', async () => {
      const mockDb = {
        listContexts: vi.fn().mockReturnValue([]),
        getStats: vi.fn().mockReturnValue({ total: 0 }),
        close: vi.fn(),
      };
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

      const command = createAgentContextCommand();
      await command.parseAsync(['list', '--tag', 'important'], { from: 'user' });

      expect(mockDb.listContexts).toHaveBeenCalledWith({ tag: 'important' });
    });

    it('should filter by priority', async () => {
      const mockDb = {
        listContexts: vi.fn().mockReturnValue([]),
        getStats: vi.fn().mockReturnValue({ total: 0 }),
        close: vi.fn(),
      };
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

      const command = createAgentContextCommand();
      await command.parseAsync(['list', '--priority', 'high'], { from: 'user' });

      expect(mockDb.listContexts).toHaveBeenCalledWith({ priority: 'high' });
    });

    it('should show message when no contexts found', async () => {
      const mockDb = {
        listContexts: vi.fn().mockReturnValue([]),
        getStats: vi.fn().mockReturnValue({ total: 0 }),
        close: vi.fn(),
      };
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

      const command = createAgentContextCommand();
      await command.parseAsync(['list'], { from: 'user' });

      expect(ui.warn).toHaveBeenCalledWith('No contexts found');
      expect(ui.muted).toHaveBeenCalledWith('Add your first context with: neo agent context add "Your context here"');
    });

    it('should exit when database path not found', async () => {
      vi.mocked(getAgentDbPath).mockResolvedValue(null);

      const command = createAgentContextCommand();
      await command.parseAsync(['list'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Failed to get database path');
      expect(exitMock).toHaveBeenCalledWith(1);
    });
  });

  describe('context remove', () => {
    it('should remove context when confirmed', async () => {
      const mockContext = {
        id: 'ctx-123',
        content: 'Test context',
        tags: ['test'],
        priority: 'medium',
        created_at: new Date('2024-01-01'),
      };
      const mockDb = {
        getContext: vi.fn().mockReturnValue(mockContext),
        removeContext: vi.fn().mockReturnValue(true),
        close: vi.fn(),
      };
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirmed: true });

      const command = createAgentContextCommand();
      await command.parseAsync(['remove', 'ctx-123'], { from: 'user' });

      expect(ensureAgentInitialized).toHaveBeenCalled();
      expect(mockDb.getContext).toHaveBeenCalledWith('ctx-123');
      expect(mockDb.removeContext).toHaveBeenCalledWith('ctx-123');
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should not remove context when cancelled', async () => {
      const mockContext = {
        id: 'ctx-123',
        content: 'Test context',
        tags: [],
        priority: 'medium',
        created_at: new Date('2024-01-01'),
      };
      const mockDb = {
        getContext: vi.fn().mockReturnValue(mockContext),
        removeContext: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirmed: false });

      const command = createAgentContextCommand();
      await command.parseAsync(['remove', 'ctx-123'], { from: 'user' });

      expect(mockDb.removeContext).not.toHaveBeenCalled();
      expect(ui.info).toHaveBeenCalledWith('Context removal cancelled');
    });

    it('should error when context not found', async () => {
      const mockDb = {
        getContext: vi.fn().mockReturnValue(null),
        close: vi.fn(),
      };
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

      const command = createAgentContextCommand();
      await command.parseAsync(['remove', 'non-existent'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Context not found');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should exit when database path not found', async () => {
      vi.mocked(getAgentDbPath).mockResolvedValue(null);

      const command = createAgentContextCommand();
      await command.parseAsync(['remove', 'ctx-123'], { from: 'user' });

      expect(ui.error).toHaveBeenCalledWith('Failed to get database path');
      expect(exitMock).toHaveBeenCalledWith(1);
    });

    it('should handle removal failure', async () => {
      const mockContext = {
        id: 'ctx-123',
        content: 'Test context',
        tags: [],
        priority: 'medium',
        created_at: new Date('2024-01-01'),
      };
      const mockDb = {
        getContext: vi.fn().mockReturnValue(mockContext),
        removeContext: vi.fn().mockReturnValue(false),
        close: vi.fn(),
      };
      vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
      vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);
      vi.mocked(inquirer.prompt).mockResolvedValue({ confirmed: true });

      const command = createAgentContextCommand();
      await command.parseAsync(['remove', 'ctx-123'], { from: 'user' });

      // The spinner's fail method would be called
      expect(mockDb.removeContext).toHaveBeenCalledWith('ctx-123');
    });
  });
});

describe('truncateText helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test indirectly through context list command
  it('should truncate long content in list output', async () => {
    const longContent = 'A'.repeat(100);
    const mockContexts = [
      {
        id: 'ctx-123',
        content: longContent,
        tags: [],
        priority: 'medium',
        created_at: new Date('2024-01-01'),
      },
    ];
    const mockDb = {
      listContexts: vi.fn().mockReturnValue(mockContexts),
      getStats: vi.fn().mockReturnValue({ total: 1 }),
      close: vi.fn(),
    };
    vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
    vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

    const command = createAgentContextCommand();
    await command.parseAsync(['list'], { from: 'user' });

    expect(ui.table).toHaveBeenCalled();
    const tableCall = vi.mocked(ui.table).mock.calls[0][0];
    const contentCell = tableCall.rows[0][1];
    // Content should be truncated to 50 chars with ellipsis
    expect(contentCell.length).toBeLessThanOrEqual(50);
    expect(contentCell).toContain('...');
  });

  it('should not truncate short content', async () => {
    const shortContent = 'Short content';
    const mockContexts = [
      {
        id: 'ctx-123',
        content: shortContent,
        tags: [],
        priority: 'medium',
        created_at: new Date('2024-01-01'),
      },
    ];
    const mockDb = {
      listContexts: vi.fn().mockReturnValue(mockContexts),
      getStats: vi.fn().mockReturnValue({ total: 1 }),
      close: vi.fn(),
    };
    vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
    vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

    const command = createAgentContextCommand();
    await command.parseAsync(['list'], { from: 'user' });

    const tableCall = vi.mocked(ui.table).mock.calls[0][0];
    const contentCell = tableCall.rows[0][1];
    expect(contentCell).toBe(shortContent);
  });
});

describe('formatPriority helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test indirectly through context list command
  it('should format critical priority', async () => {
    const mockContexts = [
      {
        id: 'ctx-123',
        content: 'Test',
        tags: [],
        priority: 'critical',
        created_at: new Date('2024-01-01'),
      },
    ];
    const mockDb = {
      listContexts: vi.fn().mockReturnValue(mockContexts),
      getStats: vi.fn().mockReturnValue({ total: 1 }),
      close: vi.fn(),
    };
    vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
    vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

    const command = createAgentContextCommand();
    await command.parseAsync(['list'], { from: 'user' });

    const tableCall = vi.mocked(ui.table).mock.calls[0][0];
    const priorityCell = tableCall.rows[0][3];
    expect(priorityCell).toContain('Critical');
  });

  it('should format high priority', async () => {
    const mockContexts = [
      {
        id: 'ctx-123',
        content: 'Test',
        tags: [],
        priority: 'high',
        created_at: new Date('2024-01-01'),
      },
    ];
    const mockDb = {
      listContexts: vi.fn().mockReturnValue(mockContexts),
      getStats: vi.fn().mockReturnValue({ total: 1 }),
      close: vi.fn(),
    };
    vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
    vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

    const command = createAgentContextCommand();
    await command.parseAsync(['list'], { from: 'user' });

    const tableCall = vi.mocked(ui.table).mock.calls[0][0];
    const priorityCell = tableCall.rows[0][3];
    expect(priorityCell).toContain('High');
  });

  it('should format medium priority', async () => {
    const mockContexts = [
      {
        id: 'ctx-123',
        content: 'Test',
        tags: [],
        priority: 'medium',
        created_at: new Date('2024-01-01'),
      },
    ];
    const mockDb = {
      listContexts: vi.fn().mockReturnValue(mockContexts),
      getStats: vi.fn().mockReturnValue({ total: 1 }),
      close: vi.fn(),
    };
    vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
    vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

    const command = createAgentContextCommand();
    await command.parseAsync(['list'], { from: 'user' });

    const tableCall = vi.mocked(ui.table).mock.calls[0][0];
    const priorityCell = tableCall.rows[0][3];
    expect(priorityCell).toContain('Medium');
  });

  it('should format low priority', async () => {
    const mockContexts = [
      {
        id: 'ctx-123',
        content: 'Test',
        tags: [],
        priority: 'low',
        created_at: new Date('2024-01-01'),
      },
    ];
    const mockDb = {
      listContexts: vi.fn().mockReturnValue(mockContexts),
      getStats: vi.fn().mockReturnValue({ total: 1 }),
      close: vi.fn(),
    };
    vi.mocked(getAgentDbPath).mockResolvedValue('/test/path/agent.db');
    vi.mocked(ContextDB.create).mockResolvedValue(mockDb as never);

    const command = createAgentContextCommand();
    await command.parseAsync(['list'], { from: 'user' });

    const tableCall = vi.mocked(ui.table).mock.calls[0][0];
    const priorityCell = tableCall.rows[0][3];
    expect(priorityCell).toContain('Low');
  });
});
