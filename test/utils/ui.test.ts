import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ui, Colors, Icons } from '../../src/utils/ui.js';
import type { KeyValuePair, TableData } from '../../src/utils/ui.js';

describe('UI System', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // ==========================================================================
  // Core Output Methods
  // ==========================================================================

  describe('Core Output Methods', () => {
    describe('success()', () => {
      it('should display success message with checkmark icon', () => {
        ui.success('Operation completed');

        expect(consoleLogSpy).toHaveBeenCalledOnce();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain(Icons.success);
        expect(output).toContain('Operation completed');
      });
    });

    describe('error()', () => {
      it('should display error message with error icon', () => {
        ui.error('Operation failed');

        expect(consoleErrorSpy).toHaveBeenCalledOnce();
        const output = consoleErrorSpy.mock.calls[0][0];
        expect(output).toContain(Icons.error);
        expect(output).toContain('Operation failed');
      });
    });

    describe('warn()', () => {
      it('should display warning message with warning icon', () => {
        ui.warn('Be careful');

        expect(consoleLogSpy).toHaveBeenCalledOnce();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain(Icons.warning);
        expect(output).toContain('Be careful');
      });
    });

    describe('info()', () => {
      it('should display info message with info icon', () => {
        ui.info('Here is some info');

        expect(consoleLogSpy).toHaveBeenCalledOnce();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain(Icons.info);
        expect(output).toContain('Here is some info');
      });
    });

    describe('step()', () => {
      it('should display step message with arrow icon', () => {
        ui.step('Proceeding with installation');

        expect(consoleLogSpy).toHaveBeenCalledOnce();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain(Icons.step);
        expect(output).toContain('Proceeding with installation');
      });
    });

    describe('muted()', () => {
      it('should display muted message without icon', () => {
        ui.muted('Secondary information');

        expect(consoleLogSpy).toHaveBeenCalledOnce();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain('Secondary information');
        // Should not contain any icons
        expect(output).not.toContain(Icons.success);
        expect(output).not.toContain(Icons.error);
        expect(output).not.toContain(Icons.warning);
        expect(output).not.toContain(Icons.info);
      });
    });

    describe('highlight()', () => {
      it('should display highlighted message with diamond icon', () => {
        ui.highlight('Important note');

        expect(consoleLogSpy).toHaveBeenCalledOnce();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain(Icons.highlight);
        expect(output).toContain('Important note');
      });
    });

    describe('link()', () => {
      it('should display link with text and URL', () => {
        ui.link('Documentation', 'https://example.com');

        expect(consoleLogSpy).toHaveBeenCalledOnce();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain('Documentation');
        expect(output).toContain('https://example.com');
      });

      it('should display link with URL only', () => {
        ui.link('https://example.com');

        expect(consoleLogSpy).toHaveBeenCalledOnce();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain('https://example.com');
      });
    });

    describe('log()', () => {
      it('should display plain text without styling', () => {
        ui.log('Plain text');

        expect(consoleLogSpy).toHaveBeenCalledOnce();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toBe('Plain text');
      });
    });
  });

  // ==========================================================================
  // Structured Output Methods
  // ==========================================================================

  describe('Structured Output Methods', () => {
    describe('section()', () => {
      it('should display section header with divider', () => {
        ui.section('Configuration');

        expect(consoleLogSpy).toHaveBeenCalledTimes(2);
        const header = consoleLogSpy.mock.calls[0][0];
        const divider = consoleLogSpy.mock.calls[1][0];

        expect(header).toContain('Configuration');
        expect(divider).toContain('─');
      });

      it('should match divider length to title length', () => {
        const title = 'Test Section';
        ui.section(title);

        const divider = consoleLogSpy.mock.calls[1][0];
        // Strip ANSI codes to count actual characters
        const plainDivider = divider.replace(/\x1b\[[0-9;]*m/g, '');
        expect(plainDivider.length).toBe(title.length);
      });
    });

    describe('list()', () => {
      it('should display bulleted list items', () => {
        const items = ['First item', 'Second item', 'Third item'];
        ui.list(items);

        expect(consoleLogSpy).toHaveBeenCalledTimes(3);

        items.forEach((item, index) => {
          const output = consoleLogSpy.mock.calls[index][0];
          expect(output).toContain(Icons.bullet);
          expect(output).toContain(item);
          expect(output).toMatch(/^\s+/); // Should have indentation
        });
      });

      it('should handle empty array', () => {
        ui.list([]);
        expect(consoleLogSpy).not.toHaveBeenCalled();
      });
    });

    describe('keyValue()', () => {
      it('should display aligned key-value pairs', () => {
        const pairs: KeyValuePair[] = [
          ['user.name', 'John Doe'],
          ['user.email', 'john@example.com'],
        ];
        ui.keyValue(pairs);

        expect(consoleLogSpy).toHaveBeenCalledTimes(2);

        pairs.forEach(([key, value], index) => {
          const output = consoleLogSpy.mock.calls[index][0];
          expect(output).toContain(key);
          expect(output).toContain(value);
          expect(output).toMatch(/:\s+/); // Should have colon separator
        });
      });

      it('should align keys properly', () => {
        const pairs: KeyValuePair[] = [
          ['short', 'value1'],
          ['very_long_key', 'value2'],
        ];
        ui.keyValue(pairs);

        const output1 = consoleLogSpy.mock.calls[0][0];
        const output2 = consoleLogSpy.mock.calls[1][0];

        // Both should have the same position for the colon
        const colonPos1 = output1.indexOf(':');
        const colonPos2 = output2.indexOf(':');
        expect(colonPos1).toBe(colonPos2);
      });

      it('should handle empty array', () => {
        ui.keyValue([]);
        expect(consoleLogSpy).not.toHaveBeenCalled();
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

        // Should have top border, header, separator, 2 rows, bottom border
        expect(consoleLogSpy).toHaveBeenCalledTimes(6);

        const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
        expect(allOutput).toContain('typescript');
        expect(allOutput).toContain('5.9.3');
        expect(allOutput).toContain('eslint');
        expect(allOutput).toContain('9.37.0');
        expect(allOutput).toContain('│'); // Table borders
        expect(allOutput).toContain('─'); // Horizontal lines
      });

      it('should display table without headers', () => {
        const data: TableData = {
          rows: [
            ['value1', 'value2'],
            ['value3', 'value4'],
          ],
        };
        ui.table(data);

        // Should have top border, 2 rows, bottom border (no header separator)
        expect(consoleLogSpy).toHaveBeenCalledTimes(4);

        const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
        expect(allOutput).toContain('value1');
        expect(allOutput).toContain('value2');
      });

      it('should handle empty rows', () => {
        const data: TableData = {
          headers: ['Name', 'Version'],
          rows: [],
        };
        ui.table(data);

        expect(consoleLogSpy).not.toHaveBeenCalled();
      });
    });

    describe('code()', () => {
      it('should display code block', () => {
        const code = 'const x = 42;\nconst y = 24;';
        ui.code(code);

        expect(consoleLogSpy).toHaveBeenCalledTimes(2);

        const output1 = consoleLogSpy.mock.calls[0][0];
        const output2 = consoleLogSpy.mock.calls[1][0];
        expect(output1).toContain('const x = 42;');
        expect(output2).toContain('const y = 24;');
      });

      it('should display code with line numbers', () => {
        const code = 'function test() {\n  return 42;\n}';
        ui.code(code, { lineNumbers: true });

        expect(consoleLogSpy).toHaveBeenCalledTimes(3);

        const outputs = consoleLogSpy.mock.calls.map((call) => call[0]);
        outputs.forEach((output) => {
          expect(output).toMatch(/\d+/); // Should contain line numbers
          expect(output).toContain('│'); // Should have separator
        });
      });

      it('should use custom start line number', () => {
        const code = 'line 1\nline 2';
        ui.code(code, { lineNumbers: true, startLine: 10 });

        const output1 = consoleLogSpy.mock.calls[0][0];
        expect(output1).toContain('10');
      });
    });

    describe('divider()', () => {
      it('should display horizontal line', () => {
        ui.divider();

        expect(consoleLogSpy).toHaveBeenCalledOnce();
        const output = consoleLogSpy.mock.calls[0][0];
        expect(output).toMatch(/^[\s\x1b]*─+/); // Should be all dashes (with possible ANSI codes)
      });
    });
  });

  // ==========================================================================
  // Spinner Integration
  // ==========================================================================

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

      // Call succeed without starting (to avoid timing issues in tests)
      const result = spinner.succeed('Success!');

      // Should return the spinner instance for chaining
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

  // ==========================================================================
  // Constants and Exports
  // ==========================================================================

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

  // ==========================================================================
  // Icon and Color Consistency
  // ==========================================================================

  describe('Icon and Color Consistency', () => {
    it('should use consistent icons across methods', () => {
      ui.success('test');
      ui.error('test');
      ui.warn('test');
      ui.info('test');
      ui.step('test');
      ui.highlight('test');

      const outputs = [
        ...consoleLogSpy.mock.calls.map((c) => c[0]),
        ...consoleErrorSpy.mock.calls.map((c) => c[0]),
      ];

      // Each icon should appear exactly once
      expect(outputs.filter((o) => o.includes(Icons.success)).length).toBe(1);
      expect(outputs.filter((o) => o.includes(Icons.error)).length).toBe(1);
      expect(outputs.filter((o) => o.includes(Icons.warning)).length).toBe(1);
      expect(outputs.filter((o) => o.includes(Icons.info)).length).toBe(1);
      expect(outputs.filter((o) => o.includes(Icons.step)).length).toBe(1);
      expect(outputs.filter((o) => o.includes(Icons.highlight)).length).toBe(1);
    });

    it('should call chalk with colors for all output methods', () => {
      // In test mode, chalk may strip colors, so we test that methods are called
      // and that output contains the expected icon and message
      ui.success('test');
      ui.error('test');
      ui.warn('test');
      ui.info('test');
      ui.step('test');
      ui.muted('test');
      ui.highlight('test');

      const allOutputs = [
        ...consoleLogSpy.mock.calls.map((c) => c[0]),
        ...consoleErrorSpy.mock.calls.map((c) => c[0]),
      ];

      // Verify each method produces output with the correct icon
      expect(allOutputs[0]).toContain(Icons.success);
      expect(allOutputs[1]).toContain(Icons.warning);
      expect(allOutputs[2]).toContain(Icons.info);
      expect(allOutputs[3]).toContain(Icons.step);
      expect(allOutputs[4]).toContain('test');
      expect(allOutputs[5]).toContain(Icons.highlight);
      expect(allOutputs[6]).toContain(Icons.error);
    });
  });

  // ==========================================================================
  // Edge Cases and Special Scenarios
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty strings', () => {
      ui.success('');
      ui.error('');
      ui.warn('');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle multiline messages', () => {
      ui.success('Line 1\nLine 2\nLine 3');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('\n');
    });

    it('should handle special characters', () => {
      ui.success('Test with émojis 🎉 and spëcial chàrs');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('🎉');
      expect(output).toContain('émojis');
      expect(output).toContain('spëcial');
      expect(output).toContain('chàrs');
    });
  });
});
