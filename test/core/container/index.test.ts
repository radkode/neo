import { describe, it, expect, beforeEach } from 'vitest';
import { Container, Tokens } from '../../../src/core/container/index.js';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('register and resolve', () => {
    it('should register and resolve a value', () => {
      container.register('config', { useValue: { debug: true } });

      const result = container.resolve<{ debug: boolean }>('config');

      expect(result).toEqual({ debug: true });
    });

    it('should register and resolve a class', () => {
      class TestService {
        getValue() {
          return 'test';
        }
      }

      container.register('service', { useClass: TestService });

      const result = container.resolve<TestService>('service');

      expect(result).toBeInstanceOf(TestService);
      expect(result.getValue()).toBe('test');
    });

    it('should register and resolve a factory', () => {
      const factory = () => ({ created: Date.now() });

      container.register('timestamp', { useFactory: factory });

      const result = container.resolve<{ created: number }>('timestamp');

      expect(result.created).toBeTypeOf('number');
    });

    it('should register and resolve with useExisting alias', () => {
      container.register('original', { useValue: 'original-value' });
      container.register('alias', { useExisting: 'original' });

      const result = container.resolve<string>('alias');

      expect(result).toBe('original-value');
    });

    it('should support symbol tokens', () => {
      const TOKEN = Symbol('myToken');
      container.register(TOKEN, { useValue: 'symbol-value' });

      const result = container.resolve<string>(TOKEN);

      expect(result).toBe('symbol-value');
    });

    it('should support class tokens', () => {
      class MyService {
        name = 'MyService';
      }

      container.register(MyService, { useClass: MyService });

      const result = container.resolve(MyService);

      expect(result.name).toBe('MyService');
    });

    it('should throw if token not registered', () => {
      expect(() => container.resolve('unknown')).toThrow('No provider registered for token: unknown');
    });
  });

  describe('lifetime', () => {
    it('should return same instance for singleton (default)', () => {
      class Counter {
        count = 0;
      }

      container.register('counter', { useClass: Counter });

      const first = container.resolve<Counter>('counter');
      first.count = 5;
      const second = container.resolve<Counter>('counter');

      expect(second.count).toBe(5);
      expect(first).toBe(second);
    });

    it('should return new instance for transient', () => {
      class Counter {
        count = 0;
      }

      container.register('counter', { useClass: Counter }, 'transient');

      const first = container.resolve<Counter>('counter');
      first.count = 5;
      const second = container.resolve<Counter>('counter');

      expect(second.count).toBe(0);
      expect(first).not.toBe(second);
    });

    it('should call factory each time for transient', () => {
      let callCount = 0;
      container.register('factory', { useFactory: () => ++callCount }, 'transient');

      container.resolve('factory');
      container.resolve('factory');
      container.resolve('factory');

      expect(callCount).toBe(3);
    });

    it('should call factory once for singleton', () => {
      let callCount = 0;
      container.register('factory', { useFactory: () => ++callCount }, 'singleton');

      container.resolve('factory');
      container.resolve('factory');
      container.resolve('factory');

      expect(callCount).toBe(1);
    });
  });

  describe('has', () => {
    it('should return true for registered token', () => {
      container.register('exists', { useValue: true });

      expect(container.has('exists')).toBe(true);
    });

    it('should return false for unregistered token', () => {
      expect(container.has('not-exists')).toBe(false);
    });
  });

  describe('createScope', () => {
    it('should create child container', () => {
      container.register('parent-value', { useValue: 'from-parent' });

      const scope = container.createScope();

      expect(scope.resolve('parent-value')).toBe('from-parent');
    });

    it('should allow scope to override parent registrations', () => {
      container.register('value', { useValue: 'parent' });

      const scope = container.createScope() as Container;
      scope.register('value', { useValue: 'child' });

      expect(container.resolve('value')).toBe('parent');
      expect(scope.resolve('value')).toBe('child');
    });

    it('should check parent for unregistered tokens', () => {
      container.register('parent-only', { useValue: 'from-parent' });

      const scope = container.createScope();

      expect(scope.has('parent-only')).toBe(true);
      expect(scope.resolve('parent-only')).toBe('from-parent');
    });

    it('should not affect parent when scope registers', () => {
      const scope = container.createScope() as Container;
      scope.register('scope-only', { useValue: 'from-scope' });

      expect(scope.has('scope-only')).toBe(true);
      expect(container.has('scope-only')).toBe(false);
    });
  });

  describe('shorthand methods', () => {
    it('registerValue should register a value', () => {
      container.registerValue('key', 'value');

      expect(container.resolve('key')).toBe('value');
    });

    it('registerClass should register a class', () => {
      class TestClass {
        id = 123;
      }

      container.registerClass('test', TestClass);

      const result = container.resolve<TestClass>('test');
      expect(result.id).toBe(123);
    });

    it('registerFactory should register a factory', () => {
      container.registerFactory('random', () => Math.random());

      const result = container.resolve<number>('random');
      expect(result).toBeTypeOf('number');
    });

    it('registerClass with transient lifetime', () => {
      class Counter {
        static count = 0;
        id: number;
        constructor() {
          this.id = ++Counter.count;
        }
      }
      Counter.count = 0;

      container.registerClass('counter', Counter, 'transient');

      const first = container.resolve<Counter>('counter');
      const second = container.resolve<Counter>('counter');

      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all registrations', () => {
      container.register('a', { useValue: 1 });
      container.register('b', { useValue: 2 });

      container.clear();

      expect(container.has('a')).toBe(false);
      expect(container.has('b')).toBe(false);
      expect(container.size).toBe(0);
    });

    it('should clear cached instances', () => {
      class Counter {
        count = 0;
      }

      container.register('counter', { useClass: Counter });
      const first = container.resolve<Counter>('counter');
      first.count = 10;

      container.clear();
      container.register('counter', { useClass: Counter });
      const second = container.resolve<Counter>('counter');

      expect(second.count).toBe(0);
    });
  });

  describe('size', () => {
    it('should return number of registrations', () => {
      expect(container.size).toBe(0);

      container.register('a', { useValue: 1 });
      expect(container.size).toBe(1);

      container.register('b', { useValue: 2 });
      expect(container.size).toBe(2);
    });
  });

  describe('Tokens', () => {
    it('should have predefined tokens', () => {
      expect(Tokens.Logger).toBeTypeOf('symbol');
      expect(Tokens.Config).toBeTypeOf('symbol');
      expect(Tokens.EventBus).toBeTypeOf('symbol');
      expect(Tokens.HttpClient).toBeTypeOf('symbol');
      expect(Tokens.FileSystem).toBeTypeOf('symbol');
    });

    it('should work with predefined tokens', () => {
      const mockLogger = { log: () => {} };
      container.register(Tokens.Logger, { useValue: mockLogger });

      const result = container.resolve(Tokens.Logger);

      expect(result).toBe(mockLogger);
    });
  });

  describe('re-registration', () => {
    it('should allow re-registering a token', () => {
      container.register('value', { useValue: 'first' });
      container.register('value', { useValue: 'second' });

      expect(container.resolve('value')).toBe('second');
    });

    it('should clear cached instance on re-registration', () => {
      class Service {
        id = Math.random();
      }

      container.register('service', { useClass: Service });
      const first = container.resolve<Service>('service');

      container.register('service', { useClass: Service });
      const second = container.resolve<Service>('service');

      expect(first.id).not.toBe(second.id);
    });
  });
});
