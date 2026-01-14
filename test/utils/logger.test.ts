import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../src/utils/logger.js';
import { LogLevel } from '../../src/core/interfaces/index.js';

describe('logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reset to default level
    logger.setLevel(LogLevel.INFO);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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

  describe('setLevel/getLevel', () => {
    it('should set and get log level', () => {
      logger.setLevel(LogLevel.WARN);
      expect(logger.getLevel()).toBe(LogLevel.WARN);
    });

    it('should default to INFO level', () => {
      expect(logger.getLevel()).toBe(LogLevel.INFO);
    });
  });

  describe('log level filtering', () => {
    it('should suppress info/success when level is WARN', () => {
      logger.setLevel(LogLevel.WARN);
      logger.info('Should not appear');
      logger.success('Should not appear');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should show warn/error when level is WARN', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('Warning message');
      logger.error('Error message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should suppress all except error when level is ERROR', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.debug('Should not appear');
      logger.info('Should not appear');
      logger.success('Should not appear');
      logger.warn('Should not appear');
      expect(consoleSpy).not.toHaveBeenCalled();

      logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should suppress all messages when level is NONE', () => {
      logger.setLevel(LogLevel.NONE);
      logger.debug('Should not appear');
      logger.info('Should not appear');
      logger.success('Should not appear');
      logger.warn('Should not appear');
      logger.error('Should not appear');
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should show all messages when level is DEBUG', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('Debug message');
      logger.info('Info message');
      logger.success('Success message');
      logger.warn('Warning message');
      expect(consoleSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('context parameter', () => {
    it('should format message with context', () => {
      logger.info('Test message', { key: 'value' });
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0]?.[1] as string;
      expect(output).toContain('Test message');
      expect(output).toContain('{"key":"value"}');
    });

    it('should not add context formatting when context is empty', () => {
      logger.info('Test message', {});
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0]?.[1]).toBe('Test message');
    });

    it('should not add context formatting when context is undefined', () => {
      logger.info('Test message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0]?.[1]).toBe('Test message');
    });
  });
});
