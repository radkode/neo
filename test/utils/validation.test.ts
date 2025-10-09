import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  validate,
  validateArgument,
  validateConfigValue,
  ValidationError,
  isValidationError,
} from '../../src/utils/validation.js';

describe('validation', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('validate', () => {
    const testSchema = z.object({
      name: z.string().min(1, 'Name is required'),
      age: z.number().min(0, 'Age must be positive'),
      email: z.string().email('Invalid email format'),
    });

    it('should validate correct data', () => {
      const validData = {
        name: 'John Doe',
        age: 30,
        email: 'john@example.com',
      };

      const result = validate(testSchema, validData, 'test data');
      expect(result).toEqual(validData);
    });

    it('should throw ValidationError for invalid data', () => {
      const invalidData = {
        name: '',
        age: -5,
        email: 'invalid-email',
      };

      expect(() => {
        validate(testSchema, invalidData, 'test data');
      }).toThrow(ValidationError);
    });

    it('should include error details in thrown error', () => {
      const invalidData = {
        name: '',
        age: 30,
        email: 'john@example.com',
      };

      try {
        validate(testSchema, invalidData, 'test data');
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.errors).toHaveLength(1);
          expect(error.errors[0]?.path).toBe('name');
        }
      }
    });

    it('should handle multiple validation errors', () => {
      const invalidData = {
        name: '',
        age: -5,
        email: 'invalid',
      };

      try {
        validate(testSchema, invalidData, 'test data');
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.errors.length).toBeGreaterThan(1);
        }
      }
    });

    it('should validate optional fields correctly', () => {
      const schemaWithOptional = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const validData = {
        required: 'value',
      };

      const result = validate(schemaWithOptional, validData, 'test data');
      expect(result).toEqual(validData);
    });
  });

  describe('validateArgument', () => {
    const stringSchema = z.string().min(1, 'Value cannot be empty');

    it('should validate correct argument', () => {
      const result = validateArgument(stringSchema, 'test value', 'test argument');
      expect(result).toBe('test value');
    });

    it('should throw ValidationError for invalid argument', () => {
      expect(() => {
        validateArgument(stringSchema, '', 'test argument');
      }).toThrow(ValidationError);
    });

    it('should include argument name in error', () => {
      try {
        validateArgument(stringSchema, '', 'config key');
        expect.fail('Should have thrown ValidationError');
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.message).toContain('config key');
        }
      }
    });

    it('should validate enum values', () => {
      const enumSchema = z.enum(['option1', 'option2', 'option3']);
      const result = validateArgument(enumSchema, 'option2', 'choice');
      expect(result).toBe('option2');
    });

    it('should reject invalid enum values', () => {
      const enumSchema = z.enum(['option1', 'option2']);
      expect(() => {
        validateArgument(enumSchema, 'invalid', 'choice');
      }).toThrow(ValidationError);
    });
  });

  describe('validateConfigValue', () => {
    it('should validate banner values', async () => {
      expect(await validateConfigValue('preferences.banner', 'full')).toBe('full');
      expect(await validateConfigValue('preferences.banner', 'compact')).toBe('compact');
      expect(await validateConfigValue('preferences.banner', 'none')).toBe('none');
    });

    it('should reject invalid banner values', async () => {
      await expect(async () => {
        await validateConfigValue('preferences.banner', 'invalid');
      }).rejects.toThrow(ValidationError);
    });

    it('should validate theme values', async () => {
      expect(await validateConfigValue('preferences.theme', 'dark')).toBe('dark');
      expect(await validateConfigValue('preferences.theme', 'light')).toBe('light');
      expect(await validateConfigValue('preferences.theme', 'auto')).toBe('auto');
    });

    it('should reject invalid theme values', async () => {
      await expect(async () => {
        await validateConfigValue('preferences.theme', 'invalid');
      }).rejects.toThrow(ValidationError);
    });

    it('should validate shell types', async () => {
      expect(await validateConfigValue('shell.type', 'zsh')).toBe('zsh');
      expect(await validateConfigValue('shell.type', 'bash')).toBe('bash');
      expect(await validateConfigValue('shell.type', 'fish')).toBe('fish');
    });

    it('should reject invalid shell types', async () => {
      await expect(async () => {
        await validateConfigValue('shell.type', 'powershell');
      }).rejects.toThrow(ValidationError);
    });

    it('should parse boolean values', async () => {
      expect(await validateConfigValue('some.bool', 'true')).toBe(true);
      expect(await validateConfigValue('some.bool', 'false')).toBe(false);
    });

    it('should parse number values', async () => {
      expect(await validateConfigValue('some.number', '42')).toBe(42);
      expect(await validateConfigValue('some.number', '0')).toBe(0);
      expect(await validateConfigValue('some.number', '-10')).toBe(-10);
    });

    it('should keep string values as strings', async () => {
      expect(await validateConfigValue('user.name', 'John Doe')).toBe('John Doe');
      expect(await validateConfigValue('user.email', 'test@example.com')).toBe('test@example.com');
    });

    it('should handle edge cases', async () => {
      // String that looks like a number but has extra characters
      expect(await validateConfigValue('some.key', '123abc')).toBe('123abc');

      // Empty string should remain empty (not parsed as number)
      expect(await validateConfigValue('some.key', 'text')).toBe('text');
    });
  });

  describe('ValidationError', () => {
    it('should create error with message and errors', () => {
      const errors = [
        { path: 'field1', message: 'Error 1' },
        { path: 'field2', message: 'Error 2' },
      ];

      const error = new ValidationError('Test error', errors);

      expect(error.message).toBe('Test error');
      expect(error.errors).toEqual(errors);
      expect(error.name).toBe('ValidationError');
    });

    it('should be instanceof Error', () => {
      const error = new ValidationError('Test', []);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('isValidationError', () => {
    it('should return true for ValidationError instances', () => {
      const error = new ValidationError('Test', []);
      expect(isValidationError(error)).toBe(true);
    });

    it('should return false for regular errors', () => {
      const error = new Error('Regular error');
      expect(isValidationError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isValidationError('string')).toBe(false);
      expect(isValidationError(123)).toBe(false);
      expect(isValidationError(null)).toBe(false);
      expect(isValidationError(undefined)).toBe(false);
      expect(isValidationError({})).toBe(false);
    });
  });
});
