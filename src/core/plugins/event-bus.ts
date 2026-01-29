/**
 * Event bus implementation for inter-component communication
 */

import type { IEventBus, EventHandler } from '@/core/interfaces/index.js';

/**
 * Simple event bus for publish/subscribe pattern
 */
export class EventBus implements IEventBus {
  private handlers: Map<string, Set<EventHandler<unknown>>> = new Map();

  /**
   * Emit an event with optional data
   */
  emit<T = unknown>(event: string, data?: T): void {
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers) return;

    for (const handler of eventHandlers) {
      try {
        const result = handler(data);
        // Handle async handlers without blocking
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(`Event handler error for "${event}":`, error);
          });
        }
      } catch (error) {
        console.error(`Event handler error for "${event}":`, error);
      }
    }
  }

  /**
   * Subscribe to an event
   */
  on<T = unknown>(event: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  /**
   * Unsubscribe from an event
   */
  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.delete(handler as EventHandler<unknown>);
      if (eventHandlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  /**
   * Subscribe to an event for a single invocation
   */
  once<T = unknown>(event: string, handler: EventHandler<T>): void {
    const wrapper: EventHandler<T> = (data) => {
      this.off(event, wrapper);
      return handler(data);
    };
    this.on(event, wrapper);
  }

  /**
   * Remove all handlers for an event or all events
   */
  clear(event?: string): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Get the number of handlers for an event
   */
  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

// Singleton instance
export const eventBus = new EventBus();
