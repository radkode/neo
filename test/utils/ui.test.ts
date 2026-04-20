import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ui, Colors, Icons } from '../../src/utils/ui.js';
import type { KeyValuePair, TableData } from '../../src/utils/ui.js';

// After the agent-compat refactor, `ui` writes diagnostic output (success, info,
// warn, etc.) to stderr, and only `ui.log()` writes to stdout. The tests below
// spy on both process streams and assert accordingly.
describe('UI System', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  const stderrOutputs = (): string[] =>
    stderrSpy.mock.calls.map((c) => String(c[0]).replace(/\n$/, ''));
  const stdoutOutputs = (): string[] =>
    stdoutSpy.mock.calls.map((c) => String(c[0]).replace(/\n$/, ''));

  describe('Core Output Methods', () => {
    describe('success()', () => {
      it('should display success message with checkmark icon (to stderr)', () => {
        ui.success('Operation completed');
        const outs = stderrOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toContain(Icons.success);
        expect(outs[0]).toContain('Operation completed');
      });
    });

    describe('error()', () => {
      it('should display error message with error icon (to stderr)', () => {
        ui.error('Operation failed');
        const outs = stderrOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toContain(Icons.error);
        expect(outs[0]).toContain('Operation failed');
      });
    });

    describe('warn()', () => {
      it('should display warning message with warning icon', () => {
        ui.warn('Be careful');
        const outs = stderrOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toContain(Icons.warning);
        expect(outs[0]).toContain('Be careful');
      });
    });

    describe('info()', () => {
      it('should display info message with info icon', () => {
        ui.info('Here is some info');
        const outs = stderrOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toContain(Icons.info);
        expect(outs[0]).toContain('Here is some info');
      });
    });

    describe('step()', () => {
      it('should display step message with arrow icon', () => {
        ui.step('Proceeding with installation');
        const outs = stderrOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toContain(Icons.step);
        expect(outs[0]).toContain('Proceeding with installation');
      });
    });

    describe('muted()', () => {
      it('should display muted message without icon', () => {
        ui.muted('Secondary information');
        const outs = stderrOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toContain('Secondary information');
        expect(outs[0]).not.toContain(Icons.success);
        expect(outs[0]).not.toContain(Icons.error);
        expect(outs[0]).not.toContain(Icons.warning);
        expect(outs[0]).not.toContain(Icons.info);
      });
    });

    describe('highlight()', () => {
      it('should display highlighted message with diamond icon', () => {
        ui.highlight('Important note');
        const outs = stderrOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toContain(Icons.highlight);
        expect(outs[0]).toContain('Important note');
      });
    });

    describe('link()', () => {
      it('should display link with text and URL', () => {
        ui.link('Documentation', 'https://example.com');
        const outs = stderrOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toContain('Documentation');
        expect(outs[0]).toContain('https://example.com');
      });

      it('should display link with URL only', () => {
        ui.link('https://example.com');
        const outs = stderrOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toContain('https://example.com');
      });
    });

    describe('log()', () => {
      it('should display plain text to stdout', () => {
        ui.log('Plain text');
        const outs = stdoutOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toBe('Plain text');
      });
    });
  });

  describe('Structured Output Methods', () => {
    describe('section()', () => {
      it('should display section header with divider', () => {
        ui.section('Configuration');
        const outs = stderrOutputs();
        expect(outs).toHaveLength(2);
        expect(outs[0]).toContain('Configuration');
        expect(outs[1]).toContain('─');
      });

      it('should match divider length to title length', () => {
        const title = 'Test Section';
        ui.section(title);
        const outs = stderrOutputs();
        const plainDivider = outs[1]!.replace(/\x1b\[[0-9;]*m/g, '');
        expect(plainDivider.length).toBe(title.length);
      });
    });

    describe('list()', () => {
      it('should display bulleted list items', () => {
        const items = ['First item', 'Second item', 'Third item'];
        ui.list(items);
        const outs = stderrOutputs();
        expect(outs).toHaveLength(3);
        items.forEach((item, i) => {
          expect(outs[i]).toContain(Icons.bullet);
          expect(outs[i]).toContain(item);
          expect(outs[i]).toMatch(/^\s+/);
        });
      });

      it('should handle empty array', () => {
        ui.list([]);
        expect(stderrSpy).not.toHaveBeenCalled();
      });
    });

    describe('keyValue()', () => {
      it('should display aligned key-value pairs', () => {
        const pairs: KeyValuePair[] = [
          ['user.name', 'John Doe'],
          ['user.email', 'john@example.com'],
        ];
        ui.keyValue(pairs);
        const outs = stderrOutputs();
        expect(outs).toHaveLength(2);
        pairs.forEach(([key, value], i) => {
          expect(outs[i]).toContain(key);
          expect(outs[i]).toContain(value);
          expect(outs[i]).toMatch(/:\s+/);
        });
      });

      it('should align keys properly', () => {
        const pairs: KeyValuePair[] = [
          ['short', 'value1'],
          ['very_long_key', 'value2'],
        ];
        ui.keyValue(pairs);
        const outs = stderrOutputs();
        const colonPos1 = outs[0]!.indexOf(':');
        const colonPos2 = outs[1]!.indexOf(':');
        expect(colonPos1).toBe(colonPos2);
      });

      it('should handle empty array', () => {
        ui.keyValue([]);
        expect(stderrSpy).not.toHaveBeenCalled();
      });
    });

    describe('table()', () => {
      it('should display table with headers and rows', () => {
        const data: TableData = {
          headers: ['Name', 'Version'],
          rows: [
            ['typescript', '5.9.3'],
            ['eslint', '9.37.0'],
          ],
        };
        ui.table(data);
        const outs = stderrOutputs();
        expect(outs).toHaveLength(6);
        const allOutput = outs.join('\n');
        expect(allOutput).toContain('typescript');
        expect(allOutput).toContain('5.9.3');
        expect(allOutput).toContain('eslint');
        expect(allOutput).toContain('9.37.0');
        expect(allOutput).toContain('│');
        expect(allOutput).toContain('─');
      });

      it('should display table without headers', () => {
        const data: TableData = {
          rows: [
            ['value1', 'value2'],
            ['value3', 'value4'],
          ],
        };
        ui.table(data);
        const outs = stderrOutputs();
        expect(outs).toHaveLength(4);
        const allOutput = outs.join('\n');
        expect(allOutput).toContain('value1');
        expect(allOutput).toContain('value2');
      });

      it('should handle empty rows', () => {
        const data: TableData = {
          headers: ['Name', 'Version'],
          rows: [],
        };
        ui.table(data);
        expect(stderrSpy).not.toHaveBeenCalled();
      });
    });

    describe('code()', () => {
      it('should display code block', () => {
        const code = 'const x = 42;\nconst y = 24;';
        ui.code(code);
        const outs = stderrOutputs();
        expect(outs).toHaveLength(2);
        expect(outs[0]).toContain('const x = 42;');
        expect(outs[1]).toContain('const y = 24;');
      });

      it('should display code with line numbers', () => {
        const code = 'function test() {\n  return 42;\n}';
        ui.code(code, { lineNumbers: true });
        const outs = stderrOutputs();
        expect(outs).toHaveLength(3);
        outs.forEach((output) => {
          expect(output).toMatch(/\d+/);
          expect(output).toContain('│');
        });
      });

      it('should use custom start line number', () => {
        const code = 'line 1\nline 2';
        ui.code(code, { lineNumbers: true, startLine: 10 });
        const outs = stderrOutputs();
        expect(outs[0]).toContain('10');
      });
    });

    describe('divider()', () => {
      it('should display horizontal line', () => {
        ui.divider();
        const outs = stderrOutputs();
        expect(outs).toHaveLength(1);
        expect(outs[0]).toMatch(/^[\s\x1b]*─+/);
      });
    });
  });

  describe('Spinner Integration', () => {
    it('should create a spinner instance', () => {
      const spinner = ui.spinner('Loading...');
      expect(spinner).toBeDefined();
      expect(typeof spinner.start).toBe('function');
      expect(typeof spinner.stop).toBe('function');
      expect(typeof spinner.succeed).toBe('function');
      expect(typeof spinner.fail).toBe('function');
      expect(typeof spinner.warn).toBe('function');
      expect(typeof spinner.info).toBe('function');
    });

    it('should have styled succeed method', () => {
      const spinner = ui.spinner('Loading...');
      const result = spinner.succeed('Success!');
      expect(result).toBe(spinner);
    });

    it('should have styled fail method', () => {
      const spinner = ui.spinner('Loading...');
      const result = spinner.fail('Failed!');
      expect(result).toBe(spinner);
    });

    it('should have styled warn method', () => {
      const spinner = ui.spinner('Loading...');
      const result = spinner.warn('Warning!');
      expect(result).toBe(spinner);
    });

    it('should have styled info method', () => {
      const spinner = ui.spinner('Loading...');
      const result = spinner.info('Info!');
      expect(result).toBe(spinner);
    });
  });

  describe('Constants and Exports', () => {
    it('should export Colors constant', () => {
      expect(Colors).toBeDefined();
      expect(Colors.primary).toBe('#0066FF');
      expect(Colors.success).toBe('#00CC66');
      expect(Colors.error).toBe('#FF3366');
      expect(Colors.muted).toBe('#6B7280');
    });

    it('should export Icons constant', () => {
      expect(Icons).toBeDefined();
      expect(Icons.success).toBe('✓');
      expect(Icons.error).toBe('✖');
      expect(Icons.warning).toBe('⚠');
      expect(Icons.info).toBe('ℹ');
      expect(Icons.step).toBe('→');
      expect(Icons.bullet).toBe('•');
      expect(Icons.highlight).toBe('◆');
      expect(Icons.collapsed).toBe('▸');
      expect(Icons.active).toBe('◉');
    });

    it('should expose colors through ui instance', () => {
      expect(ui.colors).toBe(Colors);
    });

    it('should expose icons through ui instance', () => {
      expect(ui.icons).toBe(Icons);
    });
  });

  describe('Icon and Color Consistency', () => {
    it('should use consistent icons across methods', () => {
      ui.success('test');
      ui.error('test');
      ui.warn('test');
      ui.info('test');
      ui.step('test');
      ui.highlight('test');

      const outs = stderrOutputs();
      expect(outs.filter((o) => o.includes(Icons.success)).length).toBe(1);
      expect(outs.filter((o) => o.includes(Icons.error)).length).toBe(1);
      expect(outs.filter((o) => o.includes(Icons.warning)).length).toBe(1);
      expect(outs.filter((o) => o.includes(Icons.info)).length).toBe(1);
      expect(outs.filter((o) => o.includes(Icons.step)).length).toBe(1);
      expect(outs.filter((o) => o.includes(Icons.highlight)).length).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings (success/warn stderr, error stderr)', () => {
      ui.success('');
      ui.error('');
      ui.warn('');
      expect(stderrSpy).toHaveBeenCalledTimes(3);
    });

    it('should handle multiline messages', () => {
      ui.success('Line 1\nLine 2\nLine 3');
      const outs = stderrOutputs();
      expect(outs).toHaveLength(1);
      expect(outs[0]).toContain('\n');
    });

    it('should handle special characters', () => {
      ui.success('Test with émojis 🎉 and spëcial chàrs');
      const outs = stderrOutputs();
      expect(outs).toHaveLength(1);
      expect(outs[0]).toContain('🎉');
      expect(outs[0]).toContain('émojis');
      expect(outs[0]).toContain('spëcial');
      expect(outs[0]).toContain('chàrs');
    });
  });
});
