import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ZshIntegration } from '../../src/utils/shell.js';
import type { NeoConfig } from '../../src/utils/config.js';

// Mock the logger to avoid noisy output
vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const NEO_MARKER_START = '# === NEO CLI START ===';
const NEO_MARKER_END = '# === NEO CLI END ===';

describe('ZshIntegration', () => {
  let tempDir: string;
  let rcFile: string;
  let shell: ZshIntegration;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'neo-shell-test-'));
    rcFile = join(tempDir, '.zshrc');
    shell = new ZshIntegration(rcFile);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('constructor', () => {
    it('should use provided rc file path', () => {
      const customPath = '/custom/path/.zshrc';
      const customShell = new ZshIntegration(customPath);
      expect(customShell.getRcFile()).toBe(customPath);
    });

    it('should use default path when not provided', () => {
      // Create shell without custom path - it will use homedir()
      const defaultShell = new ZshIntegration();
      expect(defaultShell.getRcFile()).toContain('.zshrc');
    });
  });

  describe('getRcFile', () => {
    it('should return the rc file path', () => {
      expect(shell.getRcFile()).toBe(rcFile);
    });
  });

  describe('hasAlias', () => {
    it('should return false when rc file does not exist', async () => {
      const result = await shell.hasAlias('n');
      expect(result).toBe(false);
    });

    it('should return false when rc file has no NEO section', async () => {
      await writeFile(rcFile, '# Some other content\nalias foo="bar"');

      const result = await shell.hasAlias('n');
      expect(result).toBe(false);
    });

    it('should return false when alias is not in NEO section', async () => {
      await writeFile(
        rcFile,
        `# Other stuff
alias outside="cmd"

${NEO_MARKER_START}
alias n="neo"
${NEO_MARKER_END}
`
      );

      const result = await shell.hasAlias('outside');
      expect(result).toBe(false);
    });

    it('should return true when alias exists in NEO section', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
alias n="neo"
${NEO_MARKER_END}
`
      );

      const result = await shell.hasAlias('n');
      expect(result).toBe(true);
    });

    it('should not match partial alias names', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
alias neo="neo"
${NEO_MARKER_END}
`
      );

      const result = await shell.hasAlias('n');
      expect(result).toBe(false);
    });
  });

  describe('addAlias', () => {
    it('should create NEO section with alias when rc file does not exist', async () => {
      await shell.addAlias('n', 'neo');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain(NEO_MARKER_START);
      expect(content).toContain(NEO_MARKER_END);
      expect(content).toContain('alias n="neo"');
    });

    it('should create NEO section with alias when rc file exists but has no NEO section', async () => {
      await writeFile(rcFile, '# Existing content\nexport PATH=/usr/bin:$PATH\n');

      await shell.addAlias('n', 'neo');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('# Existing content');
      expect(content).toContain(NEO_MARKER_START);
      expect(content).toContain('alias n="neo"');
      expect(content).toContain(NEO_MARKER_END);
    });

    it('should add alias to existing NEO section', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
alias existing="cmd"
${NEO_MARKER_END}
`
      );

      await shell.addAlias('n', 'neo');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('alias existing="cmd"');
      expect(content).toContain('alias n="neo"');
    });

    it('should replace existing alias with same name', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
alias n="old-command"
${NEO_MARKER_END}
`
      );

      await shell.addAlias('n', 'new-command');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('alias n="new-command"');
      expect(content).not.toContain('alias n="old-command"');
    });
  });

  describe('removeAlias', () => {
    it('should do nothing when rc file does not exist', async () => {
      // Should not throw
      await shell.removeAlias('n');

      // File should still not exist
      await expect(access(rcFile)).rejects.toThrow();
    });

    it('should do nothing when NEO section does not exist', async () => {
      const originalContent = '# Some other content\nalias foo="bar"';
      await writeFile(rcFile, originalContent);

      await shell.removeAlias('n');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toBe(originalContent);
    });

    it('should remove alias from NEO section', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
alias n="neo"
alias other="cmd"
${NEO_MARKER_END}
`
      );

      await shell.removeAlias('n');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).not.toContain('alias n="neo"');
      expect(content).toContain('alias other="cmd"');
    });

    it('should remove entire NEO section when last alias is removed', async () => {
      await writeFile(
        rcFile,
        `# Before
${NEO_MARKER_START}
alias n="neo"
${NEO_MARKER_END}
# After
`
      );

      await shell.removeAlias('n');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).not.toContain(NEO_MARKER_START);
      expect(content).not.toContain(NEO_MARKER_END);
      expect(content).toContain('# Before');
      expect(content).toContain('# After');
    });
  });

  describe('hasCompletions', () => {
    it('should return false when rc file does not exist', async () => {
      const result = await shell.hasCompletions();
      expect(result).toBe(false);
    });

    it('should return false when NEO section has no completions', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
alias n="neo"
${NEO_MARKER_END}
`
      );

      const result = await shell.hasCompletions();
      expect(result).toBe(false);
    });

    it('should return true when completions are set up', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
fpath=(/some/path $fpath)
autoload -Uz compinit
compinit
${NEO_MARKER_END}
`
      );

      const result = await shell.hasCompletions();
      expect(result).toBe(true);
    });

    it('should return false when only fpath is set (no compinit)', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
fpath=(/some/path $fpath)
${NEO_MARKER_END}
`
      );

      const result = await shell.hasCompletions();
      expect(result).toBe(false);
    });
  });

  describe('addCompletions', () => {
    it('should add completions to empty NEO section', async () => {
      await shell.addCompletions('/path/to/completions');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('fpath=(/path/to/completions $fpath)');
      expect(content).toContain('autoload -Uz compinit');
      expect(content).toContain('compinit');
    });

    it('should add completions alongside existing aliases', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
alias n="neo"
${NEO_MARKER_END}
`
      );

      await shell.addCompletions('/path/to/completions');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('alias n="neo"');
      expect(content).toContain('fpath=(/path/to/completions $fpath)');
    });

    it('should replace existing completions', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
fpath=(/old/path $fpath)
autoload -Uz compinit
compinit
${NEO_MARKER_END}
`
      );

      await shell.addCompletions('/new/path');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('fpath=(/new/path $fpath)');
      expect(content).not.toContain('/old/path');
    });
  });

  describe('removeCompletions', () => {
    it('should do nothing when rc file does not exist', async () => {
      await shell.removeCompletions();
      await expect(access(rcFile)).rejects.toThrow();
    });

    it('should remove completions from NEO section', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
alias n="neo"
# Neo CLI completions
fpath=(/path/to/completions $fpath)
autoload -Uz compinit
compinit
${NEO_MARKER_END}
`
      );

      await shell.removeCompletions();

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('alias n="neo"');
      expect(content).not.toContain('fpath=');
      expect(content).not.toContain('compinit');
    });

    it('should remove entire NEO section when only completions exist', async () => {
      await writeFile(
        rcFile,
        `# Other content
${NEO_MARKER_START}
# Neo CLI completions
fpath=(/path/to/completions $fpath)
autoload -Uz compinit
compinit
${NEO_MARKER_END}
`
      );

      await shell.removeCompletions();

      const content = await readFile(rcFile, 'utf-8');
      expect(content).not.toContain(NEO_MARKER_START);
      expect(content).not.toContain(NEO_MARKER_END);
      expect(content).toContain('# Other content');
    });
  });

  describe('backup', () => {
    it('should return null when rc file does not exist', async () => {
      const result = await shell.backup();
      expect(result).toBeNull();
    });

    it('should create backup file with timestamp', async () => {
      await writeFile(rcFile, 'original content');

      const backupPath = await shell.backup();

      expect(backupPath).not.toBeNull();
      expect(backupPath).toContain('.neo-backup.');
      expect(backupPath).toContain(rcFile);

      const backupContent = await readFile(backupPath!, 'utf-8');
      expect(backupContent).toBe('original content');
    });
  });

  describe('applyConfig', () => {
    it('should add alias when config.preferences.aliases.n is true', async () => {
      const config = {
        preferences: {
          aliases: { n: true },
        },
        installation: {},
      } as NeoConfig;

      await shell.applyConfig(config);

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('alias n="neo"');
    });

    it('should remove alias when config.preferences.aliases.n is false', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
alias n="neo"
alias other="cmd"
${NEO_MARKER_END}
`
      );

      const config = {
        preferences: {
          aliases: { n: false },
        },
        installation: {},
      } as NeoConfig;

      await shell.applyConfig(config);

      const content = await readFile(rcFile, 'utf-8');
      expect(content).not.toContain('alias n="neo"');
    });

    it('should add completions when completionsPath is configured', async () => {
      const config = {
        preferences: {
          aliases: { n: false },
        },
        installation: {
          completionsPath: '/path/to/completions',
        },
      } as NeoConfig;

      await shell.applyConfig(config);

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('fpath=(/path/to/completions $fpath)');
    });

    it('should apply both alias and completions', async () => {
      const config = {
        preferences: {
          aliases: { n: true },
        },
        installation: {
          completionsPath: '/path/to/completions',
        },
      } as NeoConfig;

      await shell.applyConfig(config);

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('alias n="neo"');
      expect(content).toContain('fpath=(/path/to/completions $fpath)');
    });
  });

  describe('cleanup', () => {
    it('should do nothing when rc file does not exist', async () => {
      await shell.cleanup();
      await expect(access(rcFile)).rejects.toThrow();
    });

    it('should do nothing when no NEO section exists', async () => {
      const originalContent = '# Regular content\nexport PATH=/usr/bin:$PATH';
      await writeFile(rcFile, originalContent);

      await shell.cleanup();

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toBe(originalContent);
    });

    it('should remove entire NEO section', async () => {
      await writeFile(
        rcFile,
        `# Before
${NEO_MARKER_START}
alias n="neo"
fpath=(/path $fpath)
autoload -Uz compinit
compinit
${NEO_MARKER_END}
# After
`
      );

      await shell.cleanup();

      const content = await readFile(rcFile, 'utf-8');
      expect(content).not.toContain(NEO_MARKER_START);
      expect(content).not.toContain(NEO_MARKER_END);
      expect(content).not.toContain('alias n="neo"');
      expect(content).toContain('# Before');
      expect(content).toContain('# After');
    });
  });

  describe('edge cases', () => {
    it('should handle malformed NEO section (markers in wrong order)', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_END}
alias n="neo"
${NEO_MARKER_START}
`
      );

      const hasAlias = await shell.hasAlias('n');
      expect(hasAlias).toBe(false);
    });

    it('should handle NEO section with only start marker', async () => {
      await writeFile(
        rcFile,
        `${NEO_MARKER_START}
alias n="neo"
`
      );

      const hasAlias = await shell.hasAlias('n');
      expect(hasAlias).toBe(false);
    });

    it('should handle empty rc file', async () => {
      await writeFile(rcFile, '');

      const hasAlias = await shell.hasAlias('n');
      expect(hasAlias).toBe(false);

      await shell.addAlias('n', 'neo');
      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('alias n="neo"');
    });

    it('should preserve content outside NEO section', async () => {
      await writeFile(
        rcFile,
        `# Header comment
export PATH=/usr/bin:$PATH

${NEO_MARKER_START}
alias n="neo"
${NEO_MARKER_END}

# Footer comment
export EDITOR=vim
`
      );

      await shell.addAlias('new', 'cmd');

      const content = await readFile(rcFile, 'utf-8');
      expect(content).toContain('# Header comment');
      expect(content).toContain('export PATH=/usr/bin:$PATH');
      expect(content).toContain('# Footer comment');
      expect(content).toContain('export EDITOR=vim');
    });
  });
});
