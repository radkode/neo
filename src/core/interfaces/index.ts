/**
 * Core domain interfaces for Neo CLI
 * These interfaces define the contracts for the entire application
 */

import { Result } from '@/core/errors/index.js';
import type { Readable, Writable } from 'node:stream';

// Ensure Node.js types are available
/// <reference types="node" />

/**
 * Command option definition
 */
export interface CommandOption {
  readonly flags: string;
  readonly description: string;
  readonly defaultValue?: unknown;
  readonly required?: boolean;
  readonly validator?: (value: unknown) => boolean;
}

/**
 * Command argument definition
 */
export interface CommandArgument {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
  readonly defaultValue?: unknown;
  readonly validator?: (value: unknown) => boolean;
}

/**
 * Base command interface with generic options type
 */
export interface ICommand<TOptions = unknown> {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly aliases?: string[];
  readonly options?: CommandOption[];
  readonly arguments?: CommandArgument[];
  readonly examples?: string[];
  readonly hidden?: boolean;

  /**
   * Execute the command with validated options
   */
  execute(options: TOptions, args?: string[]): Promise<Result<void>>;

  /**
   * Validate and transform raw options to the expected type
   */
  validate(options: unknown): options is TOptions;

  /**
   * Get help text for the command
   */
  getHelp?(): string;
}

/**
 * Command metadata for registration
 */
export interface CommandMetadata {
  readonly name: string;
  readonly description: string;
  readonly group?: string;
  readonly priority?: number;
  readonly experimental?: boolean;
  readonly deprecated?: boolean;
  readonly deprecationMessage?: string;
}

/**
 * Plugin interface for extending CLI functionality
 */
export interface IPlugin {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly author?: string;
  readonly homepage?: string;
  readonly dependencies?: Record<string, string>;

  /**
   * Commands provided by the plugin
   */
  readonly commands?: ICommand[];

  /**
   * Lifecycle hooks for plugin integration
   */
  readonly hooks?: ILifecycleHooks;

  /**
   * Initialize the plugin with context
   */
  initialize(context: IPluginContext): Promise<void>;

  /**
   * Clean up plugin resources
   */
  dispose?(): Promise<void>;
}

/**
 * Plugin context provided during initialization
 */
export interface IPluginContext {
  readonly version: string;
  readonly config: IConfiguration;
  readonly logger: ILogger;
  readonly eventBus: IEventBus;
  readonly commandRegistry: ICommandRegistry;
}

/**
 * Lifecycle hooks for plugins
 */
export interface ILifecycleHooks {
  beforeCommand?: (commandName: string, options: unknown) => Promise<void>;
  afterCommand?: (commandName: string, result: Result<void>) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
  onExit?: (code: number) => Promise<void>;
}

/**
 * Logger interface
 */
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  success(message: string, context?: Record<string, unknown>): void;
  log(message: string): void;
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
}

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

/**
 * Configuration interface
 */
export interface IConfiguration {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  getAll(): Record<string, unknown>;
  validate(): Result<void>;
  save(): Promise<Result<void>>;
  load(): Promise<Result<void>>;
}

/**
 * Configuration source interface
 */
export interface IConfigurationSource {
  readonly priority: number;
  readonly name: string;
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): void;
  getAll(): Record<string, unknown>;
}

/**
 * Event bus for inter-component communication
 */
export interface IEventBus {
  emit<T = unknown>(event: string, data?: T): void;
  on<T = unknown>(event: string, handler: EventHandler<T>): void;
  off<T = unknown>(event: string, handler: EventHandler<T>): void;
  once<T = unknown>(event: string, handler: EventHandler<T>): void;
}

/**
 * Event handler type
 */
export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

/**
 * Command registry for managing commands
 */
export interface ICommandRegistry {
  register(command: ICommand, metadata?: CommandMetadata): void;
  unregister(commandName: string): void;
  get(commandName: string): ICommand | undefined;
  getAll(): ICommand[];
  getByGroup(group: string): ICommand[];
  hasCommand(commandName: string): boolean;
}

/**
 * Template engine for generating files
 */
export interface ITemplateEngine {
  render(template: string, context: Record<string, unknown>): string;
  renderFile(templatePath: string, context: Record<string, unknown>): Promise<string>;
  registerHelper(name: string, helper: TemplateHelper): void;
}

/**
 * Template helper function
 */
export type TemplateHelper = (...args: unknown[]) => unknown;

/**
 * File system abstraction
 */
export interface IFileSystem {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  deleteDirectory(path: string): Promise<void>;
  listDirectory(path: string): Promise<string[]>;
  getFileInfo(path: string): Promise<IFileInfo>;
  copyFile(source: string, destination: string): Promise<void>;
  moveFile(source: string, destination: string): Promise<void>;
}

/**
 * File information
 */
export interface IFileInfo {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly createdAt: Date;
  readonly modifiedAt: Date;
  readonly permissions: string;
}

/**
 * Process executor for running external commands
 */
export interface IProcessExecutor {
  execute(command: string, args?: string[], options?: IProcessOptions): Promise<IProcessResult>;

  spawn(command: string, args?: string[], options?: IProcessOptions): IProcess;
}

/**
 * Process execution options
 */
export interface IProcessOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly shell?: boolean;
  readonly timeout?: number;
  readonly maxBuffer?: number;
  readonly encoding?: BufferEncoding;
  readonly silent?: boolean;
}

/**
 * Process execution result
 */
export interface IProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly signal?: NodeJS.Signals;
  readonly duration: number;
}

/**
 * Running process interface
 */
export interface IProcess {
  readonly pid: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals): void;
  onExit(handler: (code: number | null) => void): void;
}

/**
 * HTTP client interface
 */
export interface IHttpClient {
  get<T = unknown>(url: string, options?: IHttpOptions): Promise<IHttpResponse<T>>;
  post<T = unknown>(url: string, data?: unknown, options?: IHttpOptions): Promise<IHttpResponse<T>>;
  put<T = unknown>(url: string, data?: unknown, options?: IHttpOptions): Promise<IHttpResponse<T>>;
  delete<T = unknown>(url: string, options?: IHttpOptions): Promise<IHttpResponse<T>>;
  patch<T = unknown>(
    url: string,
    data?: unknown,
    options?: IHttpOptions
  ): Promise<IHttpResponse<T>>;
}

/**
 * HTTP request options
 */
export interface IHttpOptions {
  readonly headers?: Record<string, string>;
  readonly timeout?: number;
  readonly params?: Record<string, string | number>;
  readonly auth?: { username: string; password: string };
  readonly proxy?: { host: string; port: number };
  readonly followRedirects?: boolean;
  readonly maxRedirects?: number;
}

/**
 * HTTP response
 */
export interface IHttpResponse<T = unknown> {
  readonly data: T;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly request: IHttpOptions;
}

/**
 * Cache interface for storing temporary data
 */
export interface ICache {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T, ttl?: number): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  size(): number;
}

/**
 * Prompt interface for user interaction
 */
export interface IPrompt {
  text(message: string, options?: ITextPromptOptions): Promise<string>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  select<T = string>(message: string, choices: IChoice<T>[]): Promise<T>;
  multiselect<T = string>(message: string, choices: IChoice<T>[]): Promise<T[]>;
  password(message: string, options?: IPasswordPromptOptions): Promise<string>;
}

/**
 * Text prompt options
 */
export interface ITextPromptOptions {
  readonly defaultValue?: string;
  readonly validator?: (value: string) => boolean | string;
  readonly placeholder?: string;
  readonly required?: boolean;
}

/**
 * Password prompt options
 */
export interface IPasswordPromptOptions {
  readonly mask?: string;
  readonly validator?: (value: string) => boolean | string;
  readonly required?: boolean;
}

/**
 * Choice for select prompts
 */
export interface IChoice<T = string> {
  readonly name: string;
  readonly value: T;
  readonly description?: string;
  readonly disabled?: boolean;
}

/**
 * Progress indicator interface
 */
export interface IProgress {
  start(message?: string): void;
  update(message: string): void;
  succeed(message?: string): void;
  fail(message?: string): void;
  warn(message?: string): void;
  info(message?: string): void;
  stop(): void;
}

/**
 * Progress bar interface
 */
export interface IProgressBar {
  start(total: number, initial?: number): void;
  update(current: number): void;
  increment(delta?: number): void;
  stop(): void;
}

/**
 * Output formatter interface
 */
export interface IOutputFormatter {
  table(headers: string[], rows: string[][]): string;
  json(data: unknown, pretty?: boolean): string;
  yaml(data: unknown): string;
  markdown(content: string): string;
  code(content: string, language?: string): string;
  success(message: string): string;
  error(message: string): string;
  warning(message: string): string;
  info(message: string): string;
}

/**
 * Dependency injection container interface
 */
export interface IContainer {
  register<T>(token: InjectionToken<T>, provider: Provider<T>): void;
  resolve<T>(token: InjectionToken<T>): T;
  has<T>(token: InjectionToken<T>): boolean;
  createScope(): IContainer;
}

/**
 * Injection token type
 */
export type InjectionToken<T> = symbol | string | { new (...args: unknown[]): T };

/**
 * Provider type for dependency injection
 */
export type Provider<T> =
  | { useClass: new (...args: unknown[]) => T }
  | { useValue: T }
  | { useFactory: (...args: unknown[]) => T }
  | { useExisting: InjectionToken<T> };

/**
 * Repository interface for data persistence
 */
export interface IRepository<T, ID = string> {
  findById(id: ID): Promise<T | undefined>;
  findAll(): Promise<T[]>;
  findBy(criteria: Partial<T>): Promise<T[]>;
  save(entity: T): Promise<T>;
  delete(id: ID): Promise<void>;
  exists(id: ID): Promise<boolean>;
  count(): Promise<number>;
}

/**
 * Unit of work interface for transactional operations
 */
export interface IUnitOfWork {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  isActive(): boolean;
}
