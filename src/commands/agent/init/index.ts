import { Command } from '@commander-js/extra-typings';
import { ContextDB } from '@/storage/db.js';
import { ui } from '@/utils/ui.js';
import { validate } from '@/utils/validation.js';
import { emitJson } from '@/utils/output.js';
import { runAction } from '@/utils/run-action.js';
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
    .action(runAction(async (options: unknown) => {
      const validatedOptions: AgentInitOptions = validate(
        agentInitOptionsSchema,
        options,
        'agent init options'
      );

      await initializeAgent(validatedOptions);
    }));

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
      throw new Error('Agent already initialized. Use --force to reinitialize.');
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
      throw new Error('Failed to get database path');
    }

    spinner.text = 'Initializing context database';
    const db = await ContextDB.create(dbPath);

    // Test database connection
    const stats = db.getStats();
    db.close();

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

    emitJson(
      {
        ok: true,
        command: 'agent.init',
        project: projectName,
        location: agentDir,
        database: 'context.db',
        contexts: stats.total,
      },
      {
        text: () => {
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
        },
      }
    );
  } catch (error) {
    if (spinner.isSpinning) spinner.fail('Failed to initialize agent');
    throw error instanceof Error ? error : new Error(String(error));
  }
}
