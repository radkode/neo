import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, LogLevel } from '../../src/utils/logger.js';

// Diagnostic output (info/success/warn/error/debug) goes to stderr; only
// logger.log() writes to stdout. This matches agent-friendly stream separation.
describe('logger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.setLevel(LogLevel.INFO);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('info', () => {
    it('should log info message to stderr with info icon', () => {
      logger.info('Test info message');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]?.[0]).toContain('Test info message');
    });
  });

  describe('success', () => {
    it('should log success message to stderr with success icon', () => {
      logger.success('Test success message');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]?.[0]).toContain('Test success message');
    });
  });

  describe('warn', () => {
    it('should log warning message to stderr with warning icon', () => {
      logger.warn('Test warning message');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]?.[0]).toContain('Test warning message');
    });
  });

  describe('error', () => {
    it('should log error message to stderr with error icon', () => {
      logger.error('Test error message');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]?.[0]).toContain('Test error message');
    });
  });

  describe('debug', () => {
    it('should not log debug message when verbose is false', () => {
      logger.setVerbose(false);
      logger.debug('Test debug message');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should log debug message to stderr when verbose is true', () => {
      logger.setVerbose(true);
      logger.debug('Test debug message');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]?.[0]).toContain('Test debug message');
    });
  });

  describe('log', () => {
    it('should log raw message to stdout', () => {
      logger.log('Plain message');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy.mock.calls[0]?.[0]).toBe('Plain message\n');
    });
  });

  describe('setVerbose', () => {
    it('should enable verbose mode', () => {
      logger.setVerbose(true);
      logger.debug('Should appear');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('should disable verbose mode', () => {
      logger.setVerbose(true);
      logger.setVerbose(false);
      logger.debug('Should not appear');
      expect(stderrSpy).not.toHaveBeenCalled();
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
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should show warn/error when level is WARN', () => {
      logger.setLevel(LogLevel.WARN);
      logger.warn('Warning message');
      logger.error('Error message');
      expect(stderrSpy).toHaveBeenCalledTimes(2);
    });

    it('should suppress all except error when level is ERROR', () => {
      logger.setLevel(LogLevel.ERROR);
      logger.debug('Should not appear');
      logger.info('Should not appear');
      logger.success('Should not appear');
      logger.warn('Should not appear');
      logger.error('Error message');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]?.[0]).toContain('Error message');
    });

    it('should suppress all messages when level is NONE', () => {
      logger.setLevel(LogLevel.NONE);
      logger.debug('Should not appear');
      logger.info('Should not appear');
      logger.success('Should not appear');
      logger.warn('Should not appear');
      logger.error('Should not appear');
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should show all messages when level is DEBUG', () => {
      logger.setLevel(LogLevel.DEBUG);
      logger.debug('Debug message');
      logger.info('Info message');
      logger.success('Success message');
      logger.warn('Warning message');
      expect(stderrSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('context parameter', () => {
    it('should format message with context', () => {
      logger.info('Test message', { key: 'value' });
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Test message');
      expect(output).toContain('{"key":"value"}');
    });

    it('should not add context formatting when context is empty', () => {
      logger.info('Test message', {});
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]?.[0]).toContain('Test message');
    });

    it('should not add context formatting when context is undefined', () => {
      logger.info('Test message');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]?.[0]).toContain('Test message');
    });
  });
});
