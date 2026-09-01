import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAgentInitCommand } from '@/commands/agent/init/index.js';
import { captureConsole, mockProcessExit, type ConsoleMocks } from '../../utils/test-helpers.js';
import { buildRuntimeContext, setRuntimeContext } from '@/utils/runtime-context.js';

// createSpinnerMock has no `isSpinning`, which src/commands/agent/init/index.ts
// reads on the failure path, so the spinner is built here instead.
const spinnerMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
  text: '',
  isSpinning: true,
}));

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
    step: vi.fn(),
    list: vi.fn(),
    spinner: vi.fn(() => spinnerMock),
  },
}));

vi.mock('@/utils/agent.js', () => ({
  createAgentDir: vi.fn(),
  getAgentDbPath: vi.fn(),
  saveAgentConfig: vi.fn(),
  updateGitignore: vi.fn(),
  getDefaultProjectName: vi.fn(),
  isAgentInitialized: vi.fn(),
}));

vi.mock('@/storage/db.js', () => ({
  ContextDB: {
    create: vi.fn(),
  },
}));

import { ui } from '@/utils/ui.js';
import { ContextDB } from '@/storage/db.js';
import {
  createAgentDir,
  getAgentDbPath,
  getDefaultProjectName,
  isAgentInitialized,
  saveAgentConfig,
  updateGitignore,
} from '@/utils/agent.js';

const AGENT_DIR = '/proj/.neo/agent';
const DB_PATH = '/proj/.neo/agent/contexts.json';

function createDbMock() {
  return {
    getStats: vi.fn().mockReturnValue({
      total: 3,
      byPriority: { low: 0, medium: 3, high: 0, critical: 0 },
      totalTags: 0,
    }),
    close: vi.fn(),
  };
}

describe('createAgentInitCommand', () => {
  let exitMock: ReturnType<typeof mockProcessExit>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let consoleMocks: ConsoleMocks;
  let dbMock: ReturnType<typeof createDbMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    spinnerMock.text = '';
    spinnerMock.isSpinning = true;
    exitMock = mockProcessExit();
    consoleMocks = captureConsole();
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    setRuntimeContext(buildRuntimeContext());

    dbMock = createDbMock();
    vi.mocked(isAgentInitialized).mockResolvedValue(false);
    vi.mocked(createAgentDir).mockResolvedValue(AGENT_DIR);
    vi.mocked(getAgentDbPath).mockResolvedValue(DB_PATH);
    vi.mocked(getDefaultProjectName).mockResolvedValue('neo');
    vi.mocked(ContextDB.create).mockResolvedValue(dbMock as never);
  });

  afterEach(() => {
    exitMock.mockRestore();
    stdoutWriteSpy.mockRestore();
    consoleMocks.restore();
    setRuntimeContext(buildRuntimeContext());
  });

  it('registers the init command with its public options', () => {
    const command = createAgentInitCommand();

    expect(command.name()).toBe('init');
    expect(command.description()).toBe(
      'Initialize agent context management in the current project'
    );
    expect(command.options.map(({ flags }) => flags)).toEqual(['--project <name>', '--force']);
  });

  it('creates the directory, database, config and gitignore entry', async () => {
    await createAgentInitCommand().parseAsync([], { from: 'user' });

    expect(createAgentDir).toHaveBeenCalledTimes(1);
    expect(ContextDB.create).toHaveBeenCalledWith(DB_PATH);
    expect(dbMock.getStats).toHaveBeenCalledTimes(1);
    expect(dbMock.close).toHaveBeenCalledTimes(1);
    expect(saveAgentConfig).toHaveBeenCalledWith({
      name: 'neo',
      created_at: expect.any(Date),
      agent_preferences: { max_context_tokens: 4000 },
    });
    expect(updateGitignore).toHaveBeenCalledTimes(1);
    expect(spinnerMock.succeed).toHaveBeenCalledWith('Agent initialized successfully');
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('renders the human summary in text mode', async () => {
    await createAgentInitCommand().parseAsync([], { from: 'user' });

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
    expect(ui.section).toHaveBeenCalledWith('Agent Context Management');
    expect(ui.keyValue).toHaveBeenCalledWith([
      ['Project', 'neo'],
      ['Location', AGENT_DIR],
      ['Database', 'context.db'],
      ['Contexts', '3'],
    ]);
    expect(ui.step).toHaveBeenCalledWith('Next steps:');
    expect(ui.list).toHaveBeenCalledWith([
      'Add context: neo agent context add "Your context here" --tag api --priority high',
      'List contexts: neo agent context list',
      'Remove context: neo agent context remove <id>',
    ]);
  });

  it('emits the agent.init envelope in json mode', async () => {
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createAgentInitCommand().parseAsync([], { from: 'user' });

    expect(ui.keyValue).not.toHaveBeenCalled();
    expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toEqual({
      ok: true,
      command: 'agent.init',
      project: 'neo',
      location: AGENT_DIR,
      database: 'context.db',
      contexts: 3,
    });
  });

  it('uses --project instead of the derived project name', async () => {
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createAgentInitCommand().parseAsync(['--project', 'custom'], { from: 'user' });

    expect(getDefaultProjectName).not.toHaveBeenCalled();
    expect(saveAgentConfig).toHaveBeenCalledWith(expect.objectContaining({ name: 'custom' }));
    expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toMatchObject({
      project: 'custom',
    });
  });

  it('refuses to reinitialize without --force', async () => {
    vi.mocked(isAgentInitialized).mockResolvedValue(true);
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createAgentInitCommand().parseAsync([], { from: 'user' });

    expect(spinnerMock.fail).toHaveBeenCalledWith('Agent already initialized in this project');
    expect(createAgentDir).not.toHaveBeenCalled();
    expect(ContextDB.create).not.toHaveBeenCalled();
    expect(saveAgentConfig).not.toHaveBeenCalled();
    expect(updateGitignore).not.toHaveBeenCalled();
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toMatchObject({
      error: {
        code: 'UNKNOWN',
        message: 'Agent already initialized. Use --force to reinitialize.',
      },
    });
  });

  it('reinitializes with --force and keeps existing data', async () => {
    vi.mocked(isAgentInitialized).mockResolvedValue(true);

    await createAgentInitCommand().parseAsync(['--force'], { from: 'user' });

    expect(ui.warn).toHaveBeenCalledWith('Reinitializing agent (existing data will be preserved)');
    expect(createAgentDir).toHaveBeenCalledTimes(1);
    expect(saveAgentConfig).toHaveBeenCalledWith(expect.objectContaining({ name: 'neo' }));
    expect(updateGitignore).toHaveBeenCalledTimes(1);
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('fails before opening the database when the db path is unavailable', async () => {
    vi.mocked(getAgentDbPath).mockResolvedValue(null);

    await createAgentInitCommand().parseAsync([], { from: 'user' });

    expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to get database path');
    expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to initialize agent');
    expect(ContextDB.create).not.toHaveBeenCalled();
    expect(saveAgentConfig).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith('Failed to get database path');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('surfaces a database failure without writing config', async () => {
    vi.mocked(ContextDB.create).mockRejectedValue(new Error('Database unavailable'));

    await createAgentInitCommand().parseAsync([], { from: 'user' });

    expect(spinnerMock.fail).toHaveBeenCalledWith('Failed to initialize agent');
    expect(saveAgentConfig).not.toHaveBeenCalled();
    expect(updateGitignore).not.toHaveBeenCalled();
    expect(ui.error).toHaveBeenCalledWith('Database unavailable');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('rejects an empty --project value before touching the project', async () => {
    setRuntimeContext(buildRuntimeContext({ json: true }));

    await createAgentInitCommand().parseAsync(['--project', ''], { from: 'user' });

    expect(isAgentInitialized).not.toHaveBeenCalled();
    expect(createAgentDir).not.toHaveBeenCalled();
    expect(exitMock).toHaveBeenCalledWith(1);
    expect(JSON.parse(String(stdoutWriteSpy.mock.calls[0]?.[0]))).toMatchObject({
      error: { message: 'Invalid agent init options' },
    });
  });
});
