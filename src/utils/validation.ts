import { z } from 'zod';
import { ui } from './ui.js';

/**
 * Validation error class for cleaner error handling
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: Array<{ path: string; message: string }>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate data against a Zod schema and display user-friendly errors
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @param context - Context string for error messages (e.g., "command options", "config value")
 * @returns Validated data
 * @throws ValidationError if validation fails
 *
 * @example
 * ```typescript
 * const options = validate(gitPushOptionsSchema, rawOptions, 'git push options');
 * ```
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  context: string = 'input'
): z.infer<T> {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.map((err) => ({
      path: err.path.join('.') || 'value',
      message: err.message,
    }));

    // Display user-friendly error messages
    ui.error(`Invalid ${context}`);
    console.log('');

    for (const error of errors) {
      if (error.path === 'value') {
        ui.warn(`✖ ${error.message}`);
      } else {
        ui.warn(`✖ ${error.path}: ${error.message}`);
      }
    }

    throw new ValidationError(`Invalid ${context}`, errors);
  }

  return result.data;
}

/**
 * Validate an argument value (like a config key or value)
 *
 * @param schema - Zod schema to validate against
 * @param value - Value to validate
 * @param name - Name of the argument for error messages
 * @returns Validated value
 * @throws ValidationError if validation fails
 *
 * @example
 * ```typescript
 * const key = validateArgument(configKeySchema, rawKey, 'configuration key');
 * ```
 */
export function validateArgument<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  name: string
): z.infer<T> {
  const result = schema.safeParse(value);

  if (!result.success) {
    const error = result.error.issues[0];
    if (error) {
      ui.error(`Invalid ${name}: ${error.message}`);
      throw new ValidationError(`Invalid ${name}`, [{ path: name, message: error.message }]);
    }
  }

  return result.data as z.infer<T>;
}

/**
 * Validate a specific config value based on its key
 * Applies contextual validation based on the configuration key
 *
 * @param key - Configuration key
 * @param value - Value to validate
 * @returns Validated value with proper type
 * @throws ValidationError if validation fails
 *
 * @example
 * ```typescript
 * const value = validateConfigValue('preferences.banner', 'full');
 * ```
 */
export async function validateConfigValue(
  key: string,
  value: string
): Promise<string | number | boolean> {
  // Import schemas dynamically to avoid circular dependencies
  const { bannerValueSchema, themeValueSchema, shellTypeSchema } = await import(
    '../types/schemas.js'
  );

  // Validate specific known config keys
  if (key === 'preferences.banner') {
    return validateArgument(bannerValueSchema, value, `${key} value`);
  }

  if (key === 'preferences.theme') {
    return validateArgument(themeValueSchema, value, `${key} value`);
  }

  if (key === 'shell.type') {
    return validateArgument(shellTypeSchema, value, `${key} value`);
  }

  // Parse value into appropriate type for other keys
  if (value === 'true') return true;
  if (value === 'false') return false;

  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  return value;
}

/**
 * Type guard to check if an error is a ValidationError
 *
 * @param error - Error to check
 * @returns True if error is a ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}
