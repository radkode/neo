import { Command } from '@commander-js/extra-typings';
import { ContextDB } from '@/storage/db.js';
import { ui } from '@/utils/ui.js';
import { validate, isValidationError } from '@/utils/validation.js';
import { agentInitOptionsSchema, type AgentInitOptions } from '@/types/schemas.js';
import {
  createAgentDir,
  getAgentDbPath,
  saveAgentConfig,
  updateGitignore,
  getDefaultProjectName,
  isAgentInitialized,
} from '@/utils/agent.js';

/**
 * Create the agent init command
 */
export function createAgentInitCommand(): Command {
  const command = new Command('init');

  command
    .description('Initialize agent context management in the current project')
    .option('--project <name>', 'project name')
    .option('--force', 'force initialization even if already initialized')
    .action(async (options: unknown) => {
      // Validate options
      let validatedOptions: AgentInitOptions;
      try {
        validatedOptions = validate(agentInitOptionsSchema, options, 'agent init options');
      } catch (error) {
        if (isValidationError(error)) {
          process.exit(1);
        }
        throw error;
      }

      await initializeAgent(validatedOptions);
    });

  return command;
}

/**
 * Initialize agent in the current project
 */
async function initializeAgent(options: AgentInitOptions): Promise<void> {
  const spinner = ui.spinner('Initializing agent context management');
  spinner.start();

  try {
    // Check if already initialized
    const alreadyInitialized = await isAgentInitialized();
    if (alreadyInitialized && !options.force) {
      spinner.fail('Agent already initialized in this project');
      ui.warn('Use --force to reinitialize');
      process.exit(1);
    }

    if (alreadyInitialized && options.force) {
      ui.warn('Reinitializing agent (existing data will be preserved)');
    }

    // Create agent directory
    const agentDir = await createAgentDir();
    spinner.text = 'Creating agent directory structure';

    // Initialize database
    const dbPath = await getAgentDbPath();
    if (!dbPath) {
      spinner.fail('Failed to get database path');
      process.exit(1);
    }

    spinner.text = 'Initializing context database';
    const db = await ContextDB.create(dbPath);

    // Test database connection
    const stats = await db.getStats();
    await db.close();

    // Create configuration
    spinner.text = 'Creating configuration';
    const projectName = options.project || (await getDefaultProjectName());
    const config = {
      name: projectName,
      created_at: new Date(),
      agent_preferences: {
        max_context_tokens: 4000,
      },
    };

    await saveAgentConfig(config);

    // Update .gitignore
    spinner.text = 'Updating .gitignore';
    await updateGitignore();

    spinner.succeed('Agent initialized successfully');

    // Display success information
    ui.section('Agent Context Management');
    ui.keyValue([
      ['Project', projectName],
      ['Location', agentDir],
      ['Database', 'context.db'],
      ['Contexts', stats.total.toString()],
    ]);

    ui.divider();
    ui.step('Next steps:');
    ui.list([
      'Add context: neo agent context add "Your context here" --tag api --priority high',
      'List contexts: neo agent context list',
      'Remove context: neo agent context remove <id>',
    ]);
  } catch (error) {
    spinner.fail('Failed to initialize agent');
    ui.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
