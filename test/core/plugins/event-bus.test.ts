import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../../../src/core/plugins/event-bus.js';
import { captureConsole, type ConsoleMocks } from '../../utils/test-helpers.js';

describe('EventBus', () => {
  let eventBus: EventBus;
  let consoleMocks: ConsoleMocks;

  beforeEach(() => {
    eventBus = new EventBus();
    consoleMocks = captureConsole();
  });

  afterEach(() => {
    consoleMocks.restore();
  });

  describe('on', () => {
    it('should register a handler for an event', () => {
      const handler = vi.fn();

      eventBus.on('test', handler);

      expect(eventBus.listenerCount('test')).toBe(1);
    });

    it('should allow multiple handlers for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      eventBus.on('test', handler1);
      eventBus.on('test', handler2);
      eventBus.on('test', handler3);

      expect(eventBus.listenerCount('test')).toBe(3);
    });

    it('should not duplicate the same handler reference', () => {
      const handler = vi.fn();

      eventBus.on('test', handler);
      eventBus.on('test', handler); // Same reference

      // Set deduplicates
      expect(eventBus.listenerCount('test')).toBe(1);
    });
  });

  describe('off', () => {
    it('should unregister a handler', () => {
      const handler = vi.fn();
      eventBus.on('test', handler);

      eventBus.off('test', handler);

      expect(eventBus.listenerCount('test')).toBe(0);
    });

    it('should only remove the specified handler', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on('test', handler1);
      eventBus.on('test', handler2);

      eventBus.off('test', handler1);

      expect(eventBus.listenerCount('test')).toBe(1);
    });

    it('should clean up event entry when last handler is removed', () => {
      const handler = vi.fn();
      eventBus.on('test', handler);

      eventBus.off('test', handler);

      // Internal cleanup - no handlers means event is removed from map
      expect(eventBus.listenerCount('test')).toBe(0);
    });

    it('should not throw when removing non-existent handler', () => {
      const handler = vi.fn();

      expect(() => eventBus.off('test', handler)).not.toThrow();
    });

    it('should not throw when event has no handlers', () => {
      const handler = vi.fn();
      eventBus.on('test', handler);
      eventBus.off('test', handler); // Remove it

      expect(() => eventBus.off('test', handler)).not.toThrow();
    });
  });

  describe('emit', () => {
    it('should call registered handlers with data', () => {
      const handler = vi.fn();
      eventBus.on('test', handler);

      eventBus.emit('test', { foo: 'bar' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
    });

    it('should call all handlers for an event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();
      eventBus.on('test', handler1);
      eventBus.on('test', handler2);
      eventBus.on('test', handler3);

      eventBus.emit('test', 'data');

      expect(handler1).toHaveBeenCalledWith('data');
      expect(handler2).toHaveBeenCalledWith('data');
      expect(handler3).toHaveBeenCalledWith('data');
    });

    it('should not throw when emitting event with no handlers', () => {
      expect(() => eventBus.emit('non-existent', 'data')).not.toThrow();
    });

    it('should work without data', () => {
      const handler = vi.fn();
      eventBus.on('test', handler);

      eventBus.emit('test');

      expect(handler).toHaveBeenCalledWith(undefined);
    });

    it('should catch and log synchronous handler errors', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const goodHandler = vi.fn();

      eventBus.on('test', errorHandler);
      eventBus.on('test', goodHandler);

      eventBus.emit('test', 'data');

      expect(consoleMocks.error).toHaveBeenCalledWith(
        'Event handler error for "test":',
        expect.any(Error)
      );
      // Good handler should still be called
      expect(goodHandler).toHaveBeenCalled();
    });

    it('should handle async handlers without blocking', async () => {
      const asyncHandler = vi.fn().mockResolvedValue('done');
      eventBus.on('test', asyncHandler);

      eventBus.emit('test', 'data');

      expect(asyncHandler).toHaveBeenCalledWith('data');
    });

    it('should catch and log async handler errors', async () => {
      const asyncErrorHandler = vi.fn().mockRejectedValue(new Error('Async error'));
      eventBus.on('test', asyncErrorHandler);

      eventBus.emit('test', 'data');

      // Wait for the async rejection to be caught
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleMocks.error).toHaveBeenCalledWith(
        'Event handler error for "test":',
        expect.any(Error)
      );
    });
  });

  describe('once', () => {
    it('should call handler only once', () => {
      const handler = vi.fn();
      eventBus.once('test', handler);

      eventBus.emit('test', 'first');
      eventBus.emit('test', 'second');
      eventBus.emit('test', 'third');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('first');
    });

    it('should remove handler after first emit', () => {
      const handler = vi.fn();
      eventBus.once('test', handler);

      eventBus.emit('test');

      expect(eventBus.listenerCount('test')).toBe(0);
    });

    it('should return handler result', () => {
      const handler = vi.fn().mockReturnValue('result');
      eventBus.once('test', handler);

      eventBus.emit('test');

      expect(handler).toHaveReturnedWith('result');
    });
  });

  describe('clear', () => {
    it('should clear all handlers for a specific event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.on('event1', handler1);
      eventBus.on('event2', handler2);

      eventBus.clear('event1');

      expect(eventBus.listenerCount('event1')).toBe(0);
      expect(eventBus.listenerCount('event2')).toBe(1);
    });

    it('should clear all handlers for all events when no event specified', () => {
      eventBus.on('event1', vi.fn());
      eventBus.on('event2', vi.fn());
      eventBus.on('event3', vi.fn());

      eventBus.clear();

      expect(eventBus.listenerCount('event1')).toBe(0);
      expect(eventBus.listenerCount('event2')).toBe(0);
      expect(eventBus.listenerCount('event3')).toBe(0);
    });

    it('should not throw when clearing non-existent event', () => {
      expect(() => eventBus.clear('non-existent')).not.toThrow();
    });
  });

  describe('listenerCount', () => {
    it('should return 0 for event with no handlers', () => {
      expect(eventBus.listenerCount('non-existent')).toBe(0);
    });

    it('should return correct count', () => {
      eventBus.on('test', vi.fn());
      eventBus.on('test', vi.fn());
      eventBus.on('test', vi.fn());

      expect(eventBus.listenerCount('test')).toBe(3);
    });

    it('should update after adding and removing handlers', () => {
      const handler = vi.fn();

      eventBus.on('test', handler);
      expect(eventBus.listenerCount('test')).toBe(1);

      eventBus.on('test', vi.fn());
      expect(eventBus.listenerCount('test')).toBe(2);

      eventBus.off('test', handler);
      expect(eventBus.listenerCount('test')).toBe(1);
    });
  });

  describe('type safety', () => {
    it('should support generic event data types', () => {
      interface UserData {
        id: number;
        name: string;
      }

      const handler = vi.fn<[UserData | undefined], void>();
      eventBus.on<UserData>('user:created', handler);

      eventBus.emit<UserData>('user:created', { id: 1, name: 'Test' });

      expect(handler).toHaveBeenCalledWith({ id: 1, name: 'Test' });
    });
  });
});
