import { Command } from '@commander-js/extra-typings';
import inquirer from 'inquirer';
import { ContextDB } from '@/storage/db.js';
import { ui } from '@/utils/ui.js';
import { validate, validateArgument, isValidationError } from '@/utils/validation.js';
import { getRuntimeContext } from '@/utils/runtime-context.js';
import { NonInteractiveError } from '@/utils/prompt.js';
import { emitJson, emitError } from '@/utils/output.js';
import {
  agentContextAddOptionsSchema,
  agentContextListOptionsSchema,
  contextIdSchema,
  contextContentSchema,
  type AgentContextAddOptions,
  type AgentContextListOptions,
  type ContextId,
  type ContextContent,
} from '@/types/schemas.js';
import { ensureAgentInitialized, getAgentDbPath } from '@/utils/agent.js';
import type { ContextItem, ContextPriority } from '@/types/agent.js';

/**
 * Create the agent context command with subcommands
 */
export function createAgentContextCommand(): Command {
  const command = new Command('context');

  command
    .description('Manage agent contexts')
    .addCommand(createContextAddCommand())
    .addCommand(createContextListCommand())
    .addCommand(createContextRemoveCommand());

  return command;
}

/**
 * Create the context add subcommand
 */
function createContextAddCommand(): Command {
  const command = new Command('add');

  command
    .description('Add a new context item')
    .argument('<content>', 'context content')
    .option('--tag <tags...>', 'tags to assign')
    .option('--priority <priority>', 'priority level (low, medium, high, critical)')
    .action(async (rawContent: string, options: unknown) => {
      await ensureAgentInitialized();

      // Validate content argument
      let content: ContextContent;
      try {
        content = validateArgument(contextContentSchema, rawContent, 'context content');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      // Validate options
      let validatedOptions: AgentContextAddOptions;
      try {
        validatedOptions = validate(agentContextAddOptionsSchema, options, 'context add options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      await addContext(content, validatedOptions);
    });

  return command;
}

/**
 * Create the context list subcommand
 */
function createContextListCommand(): Command {
  const command = new Command('list');

  command
    .description('List context items')
    .option('--tag <tag>', 'filter by tag')
    .option('--priority <priority>', 'filter by priority')
    .action(async (options: unknown) => {
      await ensureAgentInitialized();

      // Validate options
      let validatedOptions: AgentContextListOptions;
      try {
        validatedOptions = validate(agentContextListOptionsSchema, options, 'context list options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      await listContexts(validatedOptions);
    });

  return command;
}

/**
 * Create the context remove subcommand
 */
function createContextRemoveCommand(): Command {
  const command = new Command('remove');

  command
    .description('Remove a context item')
    .argument('<id>', 'context ID to remove')
    .action(async (rawId: string) => {
      await ensureAgentInitialized();

      let id: ContextId;
      try {
        id = validateArgument(contextIdSchema, rawId, 'context ID');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      try {
        await removeContext(id);
      } catch (error) {
        if (error instanceof NonInteractiveError) {
          emitError(error as unknown as Error);
          process.exit(2);
        }
        throw error;
      }
    });

  return command;
}

/**
 * Add a new context item
 */
async function addContext(content: ContextContent, options: AgentContextAddOptions): Promise<void> {
  const dbPath = await getAgentDbPath();
  if (!dbPath) {
    ui.error('Failed to get database path');
    process.exit(1);
  }

  const spinner = ui.spinner('Adding context');
  spinner.start();

  try {
    const db = await ContextDB.create(dbPath);
    const contextItem = db.addContext({
      content,
      tags: options.tag || [],
      priority: options.priority || 'medium',
    });

    db.close();
    spinner.succeed('Context added successfully');

    emitJson(
      {
        ok: true,
        command: 'agent.context.add',
        context: {
          id: contextItem.id,
          content: contextItem.content,
          tags: contextItem.tags,
          priority: contextItem.priority,
          created_at: contextItem.created_at.toISOString(),
        },
      },
      {
        text: () =>
          ui.keyValue([
            ['ID', contextItem.id],
            ['Content', contextItem.content],
            ['Tags', contextItem.tags.join(', ') || 'none'],
            ['Priority', contextItem.priority],
            ['Created', contextItem.created_at.toLocaleString()],
          ]),
      }
    );
  } catch (error) {
    spinner.fail('Failed to add context');
    ui.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * List context items with optional filtering
 */
async function listContexts(options: AgentContextListOptions): Promise<void> {
  const dbPath = await getAgentDbPath();
  if (!dbPath) {
    ui.error('Failed to get database path');
    process.exit(1);
  }

  const spinner = ui.spinner('Loading contexts');
  spinner.start();

  try {
    const db = await ContextDB.create(dbPath);
    const filters: { tag?: string; priority?: ContextPriority } = {};
    if (options.tag) filters.tag = options.tag;
    if (options.priority) filters.priority = options.priority;

    const contexts = db.listContexts(filters);
    const stats = db.getStats();
    db.close();

    spinner.succeed('Contexts loaded');

    // JSON path: emit the full structured list unconditionally.
    const rtCtx = getRuntimeContext();
    if (rtCtx.format === 'json') {
      emitJson({
        ok: true,
        command: 'agent.context.list',
        total: stats.total,
        filtered: contexts.length,
        filter: {
          tag: options.tag ?? null,
          priority: options.priority ?? null,
        },
        contexts: contexts.map((c: ContextItem) => ({
          id: c.id,
          content: c.content,
          tags: c.tags,
          priority: c.priority,
          created_at: c.created_at.toISOString(),
        })),
      });
      return;
    }

    if (contexts.length === 0) {
      ui.warn('No contexts found');
      ui.muted('Add your first context with: neo agent context add "Your context here"');
      return;
    }

    let filterSummary = `Showing ${contexts.length} of ${stats.total} contexts`;
    if (options.tag || options.priority) {
      const filters = [];
      if (options.tag) filters.push(`tag: ${options.tag}`);
      if (options.priority) filters.push(`priority: ${options.priority}`);
      filterSummary += ` (filtered by ${filters.join(', ')})`;
    }

    ui.section('Agent Contexts');
    ui.muted(filterSummary);
    ui.divider();

    const tableRows = contexts.map((context: ContextItem) => [
      context.id.slice(0, 8),
      truncateText(context.content, 50),
      context.tags.length > 0 ? context.tags.join(', ') : '—',
      formatPriority(context.priority),
      context.created_at.toLocaleDateString(),
    ]);

    ui.table({
      headers: ['ID', 'Content', 'Tags', 'Priority', 'Created'],
      rows: tableRows,
    });

    ui.divider();
    ui.muted('Use "neo agent context remove <id>" to remove a context');
  } catch (error) {
    spinner.fail('Failed to load contexts');
    ui.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Remove a context item with confirmation
 */
async function removeContext(id: ContextId): Promise<void> {
  const dbPath = await getAgentDbPath();
  if (!dbPath) {
    ui.error('Failed to get database path');
    process.exit(1);
  }

  try {
    const db = await ContextDB.create(dbPath);

    // Find the context first
    const context = db.getContext(id);
    if (!context) {
      db.close();
      ui.error('Context not found');
      ui.muted(`No context found with ID: ${id}`);
      process.exit(1);
    }

    // Show context details
    ui.section('Context to Remove');
    ui.keyValue([
      ['ID', context.id],
      ['Content', context.content],
      ['Tags', context.tags.join(', ') || 'none'],
      ['Priority', context.priority],
      ['Created', context.created_at.toLocaleString()],
    ]);

    const rtCtx = getRuntimeContext();
    let confirmed: boolean;
    if (rtCtx.yes) {
      confirmed = true;
    } else if (rtCtx.nonInteractive) {
      db.close();
      throw new NonInteractiveError(
        'Context removal requires confirmation',
        '--yes'
      );
    } else {
      const answer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: 'Are you sure you want to remove this context?',
          default: false,
        },
      ]);
      confirmed = Boolean(answer.confirmed);
    }

    if (!confirmed) {
      db.close();
      ui.info('Context removal cancelled');
      return;
    }

    const spinner = ui.spinner('Removing context');
    spinner.start();

    const removed = db.removeContext(id);
    db.close();

    if (removed) {
      spinner.succeed('Context removed successfully');
    } else {
      spinner.fail('Failed to remove context');
    }
  } catch (error) {
    ui.error('Failed to remove context');
    ui.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Truncate text to specified length
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format priority with appropriate styling
 */
function formatPriority(priority: ContextPriority): string {
  switch (priority) {
    case 'critical':
      return '🔴 Critical';
    case 'high':
      return '🟠 High';
    case 'medium':
      return '🟡 Medium';
    case 'low':
      return '🟢 Low';
    default:
      return priority;
  }
}
