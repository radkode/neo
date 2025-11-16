import { Command } from '@commander-js/extra-typings';
import inquirer from 'inquirer';
import { ContextDB } from '@/storage/db.js';
import { ui } from '@/utils/ui.js';
import { validate, validateArgument, isValidationError } from '@/utils/validation.js';
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

      // Validate ID argument
      let id: ContextId;
      try {
        id = validateArgument(contextIdSchema, rawId, 'context ID');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      await removeContext(id);
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
    const contextItem = await db.addContext({
      content,
      tags: options.tag || [],
      priority: options.priority || 'medium',
    });

    await db.close();
    spinner.succeed('Context added successfully');

    // Display the added context
    ui.keyValue([
      ['ID', contextItem.id],
      ['Content', contextItem.content],
      ['Tags', contextItem.tags.join(', ') || 'none'],
      ['Priority', contextItem.priority],
      ['Created', contextItem.created_at.toLocaleString()],
    ]);
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

    const contexts = await db.listContexts(filters);
    const stats = await db.getStats();
    await db.close();

    spinner.succeed('Contexts loaded');

    if (contexts.length === 0) {
      ui.warn('No contexts found');
      ui.muted('Add your first context with: neo agent context add "Your context here"');
      return;
    }

    // Display summary
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

    // Prepare table data
    const tableRows = contexts.map((context: ContextItem) => [
      context.id.slice(0, 8), // Short ID
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
    const context = await db.getContext(id);
    if (!context) {
      await db.close();
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

    // Confirm removal
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Are you sure you want to remove this context?',
        default: false,
      },
    ]);

    if (!confirmed) {
      await db.close();
      ui.info('Context removal cancelled');
      return;
    }

    const spinner = ui.spinner('Removing context');
    spinner.start();

    const removed = await db.removeContext(id);
    await db.close();

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
