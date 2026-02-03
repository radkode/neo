/**
 * Simple dependency injection container
 */

import type { IContainer, InjectionToken, Provider } from '@/core/interfaces/index.js';

/**
 * Lifetime options for registered services
 */
export type Lifetime = 'singleton' | 'transient';

/**
 * Registration entry with provider and lifetime
 */
interface Registration<T> {
  provider: Provider<T>;
  lifetime: Lifetime;
}

/**
 * Normalize token to string key for Map storage
 */
function tokenToKey<T>(token: InjectionToken<T>): string {
  if (typeof token === 'symbol') {
    return token.toString();
  }
  if (typeof token === 'string') {
    return token;
  }
  // Class constructor - use name
  return token.name || token.toString();
}

/**
 * Simple dependency injection container
 *
 * Supports:
 * - useValue: Register a constant value
 * - useClass: Register a class constructor
 * - useFactory: Register a factory function
 * - useExisting: Alias to another token
 * - Singleton and transient lifetimes
 * - Scoped containers for child contexts
 */
export class Container implements IContainer {
  private registrations = new Map<string, Registration<unknown>>();
  private instances = new Map<string, unknown>();
  private parent: Container | undefined;

  constructor(parent?: Container) {
    this.parent = parent;
  }

  /**
   * Register a provider for a token
   *
   * @param token - Injection token (symbol, string, or class)
   * @param provider - Provider configuration
   * @param lifetime - 'singleton' (default) or 'transient'
   */
  register<T>(token: InjectionToken<T>, provider: Provider<T>, lifetime: Lifetime = 'singleton'): void {
    const key = tokenToKey(token);
    this.registrations.set(key, { provider, lifetime });
    // Clear cached instance if re-registering
    this.instances.delete(key);
  }

  /**
   * Register a value directly (shorthand for useValue)
   */
  registerValue<T>(token: InjectionToken<T>, value: T): void {
    this.register(token, { useValue: value }, 'singleton');
  }

  /**
   * Register a class (shorthand for useClass)
   */
  registerClass<T>(
    token: InjectionToken<T>,
    cls: new (...args: unknown[]) => T,
    lifetime: Lifetime = 'singleton'
  ): void {
    this.register(token, { useClass: cls }, lifetime);
  }

  /**
   * Register a factory function (shorthand for useFactory)
   */
  registerFactory<T>(
    token: InjectionToken<T>,
    factory: () => T,
    lifetime: Lifetime = 'singleton'
  ): void {
    this.register(token, { useFactory: factory }, lifetime);
  }

  /**
   * Resolve a token to its value
   *
   * @param token - Injection token to resolve
   * @returns The resolved value
   * @throws Error if token is not registered
   */
  resolve<T>(token: InjectionToken<T>): T {
    const key = tokenToKey(token);
    const registration = this.registrations.get(key) as Registration<T> | undefined;

    if (!registration) {
      // Check parent container
      if (this.parent) {
        return this.parent.resolve(token);
      }
      throw new Error(`No provider registered for token: ${key}`);
    }

    // For singletons, check cache first
    if (registration.lifetime === 'singleton' && this.instances.has(key)) {
      return this.instances.get(key) as T;
    }

    // Create instance based on provider type
    const instance = this.createInstance(registration.provider);

    // Cache singleton instances
    if (registration.lifetime === 'singleton') {
      this.instances.set(key, instance);
    }

    return instance as T;
  }

  /**
   * Check if a token is registered
   */
  has<T>(token: InjectionToken<T>): boolean {
    const key = tokenToKey(token);
    if (this.registrations.has(key)) {
      return true;
    }
    return this.parent?.has(token) ?? false;
  }

  /**
   * Create a child container (scoped context)
   *
   * Child containers inherit registrations from parent
   * but can override with their own registrations
   */
  createScope(): IContainer {
    return new Container(this);
  }

  /**
   * Clear all registrations and cached instances
   */
  clear(): void {
    this.registrations.clear();
    this.instances.clear();
  }

  /**
   * Get the number of registrations
   */
  get size(): number {
    return this.registrations.size;
  }

  /**
   * Create an instance from a provider
   */
  private createInstance<T>(provider: Provider<T>): T {
    if ('useValue' in provider) {
      return provider.useValue;
    }

    if ('useClass' in provider) {
      return new provider.useClass();
    }

    if ('useFactory' in provider) {
      return provider.useFactory();
    }

    if ('useExisting' in provider) {
      return this.resolve(provider.useExisting);
    }

    throw new Error('Invalid provider configuration');
  }
}

/**
 * Global container instance
 */
export const container = new Container();

/**
 * Common injection tokens
 */
export const Tokens = {
  Logger: Symbol('Logger'),
  Config: Symbol('Config'),
  EventBus: Symbol('EventBus'),
  HttpClient: Symbol('HttpClient'),
  FileSystem: Symbol('FileSystem'),
} as const;
