import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../src/utils/logger.js';

describe('logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    // Reset verbose mode
    logger.setVerbose(false);
  });

  describe('info', () => {
    it('should log info message with info icon', () => {
      logger.info('Test info message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0]?.[1]).toBe('Test info message');
    });
  });

  describe('success', () => {
    it('should log success message with success icon', () => {
      logger.success('Test success message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0]?.[1]).toBe('Test success message');
    });
  });

  describe('warn', () => {
    it('should log warning message with warning icon', () => {
      logger.warn('Test warning message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0]?.[1]).toBe('Test warning message');
    });
  });

  describe('error', () => {
    it('should log error message to stderr with error icon', () => {
      logger.error('Test error message');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0]?.[1]).toBe('Test error message');
    });
  });

  describe('debug', () => {
    it('should not log debug message when verbose is false', () => {
      logger.setVerbose(false);
      logger.debug('Test debug message');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should log debug message when verbose is true', () => {
      logger.setVerbose(true);
      logger.debug('Test debug message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0]?.[1]).toBe('Test debug message');
    });
  });

  describe('log', () => {
    it('should log message without formatting', () => {
      logger.log('Plain message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0]?.[0]).toBe('Plain message');
    });
  });

  describe('setVerbose', () => {
    it('should enable verbose mode', () => {
      logger.setVerbose(true);
      logger.debug('Should appear');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it('should disable verbose mode', () => {
      logger.setVerbose(true);
      logger.setVerbose(false);
      logger.debug('Should not appear');
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});
