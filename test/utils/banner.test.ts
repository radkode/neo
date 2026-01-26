import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showBanner, showCompactBanner, displayBanner } from '../../src/utils/banner.js';
import type { BannerType } from '../../src/utils/banner.js';

describe('Banner Utilities', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('showBanner', () => {
    it('should display the full ASCII art banner', () => {
      showBanner();

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      // Check for ASCII art box-drawing characters
      expect(output).toMatch(/███/);
      expect(output).toMatch(/╗/);
      expect(output).toMatch(/╚/);
      // Should be multi-line (at least 6 lines for the ASCII art)
      expect(output.split('\n').length).toBeGreaterThan(5);
    });
  });

  describe('showCompactBanner', () => {
    it('should display the compact single-line banner', () => {
      showCompactBanner();

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('NEO CLI');
      expect(output).toContain('▐█▌');
      // Should be much shorter than full banner
      expect(output.split('\n').length).toBeLessThan(5);
    });
  });

  describe('displayBanner', () => {
    it('should display full banner when type is "full"', () => {
      displayBanner('full');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toMatch(/███/);
    });

    it('should display compact banner when type is "compact"', () => {
      displayBanner('compact');

      expect(consoleLogSpy).toHaveBeenCalledOnce();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('▐█▌');
      expect(output).toContain('NEO CLI');
    });

    it('should display nothing when type is "none"', () => {
      displayBanner('none');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should handle all valid BannerType values', () => {
      const validTypes: BannerType[] = ['full', 'compact', 'none'];

      validTypes.forEach((type) => {
        consoleLogSpy.mockClear();
        expect(() => displayBanner(type)).not.toThrow();
      });
    });
  });
});
