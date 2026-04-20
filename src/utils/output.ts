/**
 * Machine-readable output helpers.
 *
 * Commands use these to emit their final payload — stdout in JSON mode,
 * delegated to `ui` in text mode. Keeping one helper means every command
 * ships both formats without branching logic in the command itself.
 */

import { getRuntimeContext } from './runtime-context.js';
import { ui } from './ui.js';
import type { AppError } from '@/core/errors/index.js';

export interface EmitOptions {
  /** If supplied, called in text mode to render the human-friendly form. */
  text?: () => void;
}

/**
 * Emit a successful command result. Under --json, writes a single JSON object
 * to stdout. Otherwise calls the provided text renderer (if any) so the
 * human-friendly output format remains the command's choice.
 */
export function emitJson<T extends Record<string, unknown> | unknown[]>(
  data: T,
  options: EmitOptions = {}
): void {
  const ctx = getRuntimeContext();
  if (ctx.format === 'json') {
    process.stdout.write(`${JSON.stringify(data)}\n`);
    return;
  }
  if (options.text) {
    options.text();
  }
}

export interface SerializedError {
  code: string;
  message: string;
  category?: string;
  severity?: string;
  suggestions?: string[];
  context?: Record<string, unknown>;
}

/**
 * Emit an error in JSON mode as a structured object on stdout (so agents can
 * parse it alongside successful results). In text mode this falls through to
 * ui.error + suggestions for the normal human rendering.
 */
export function emitError(error: AppError | Error, options: EmitOptions = {}): void {
  const ctx = getRuntimeContext();
  if (ctx.format === 'json') {
    const payload: { error: SerializedError } = {
      error: serializeError(error),
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  if (options.text) {
    options.text();
    return;
  }
  ui.error(error.message);
  const suggestions = (error as AppError).suggestions;
  if (suggestions && suggestions.length > 0) {
    ui.warn('Suggestions:');
    ui.list(suggestions);
  }
}

function serializeError(error: AppError | Error): SerializedError {
  const appError = error as AppError;
  const serialized: SerializedError = {
    code: appError.code ?? 'UNKNOWN',
    message: error.message,
  };
  if (appError.category) serialized.category = String(appError.category);
  if (appError.severity) serialized.severity = String(appError.severity);
  if (appError.suggestions && appError.suggestions.length > 0) {
    serialized.suggestions = appError.suggestions;
  }
  if (appError.context) serialized.context = appError.context;
  return serialized;
}
