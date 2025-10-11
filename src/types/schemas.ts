import { z } from 'zod';

/**
 * Base options schema that all commands inherit from
 */
export const baseOptionsSchema = z.object({
  verbose: z.boolean().optional(),
  config: z.string().optional(),
  color: z.boolean().optional(),
  banner: z.boolean().optional(),
});

/**
 * Init command options schema
 */
export const initOptionsSchema = baseOptionsSchema.extend({
  force: z.boolean().optional(),
  skipInstall: z.boolean().optional(),
});

/**
 * Git push command options schema
 */
export const gitPushOptionsSchema = baseOptionsSchema.extend({
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
  setUpstream: z
    .string()
    .min(1, 'Branch name cannot be empty')
    .regex(/^[a-zA-Z0-9/._-]+$/, 'Invalid branch name format')
    .optional(),
  tags: z.boolean().optional(),
});

/**
 * Git pull command options schema
 */
export const gitPullOptionsSchema = baseOptionsSchema.extend({
  rebase: z.boolean().optional(),
  noRebase: z.boolean().optional(),
});

/**
 * Git branch command options schema
 */
export const gitBranchOptionsSchema = baseOptionsSchema.extend({
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
});

/**
 * Valid actions when remote branch is deleted in git pull
 */
export const deletedBranchActionSchema = z.enum(
  ['switch_main_delete', 'switch_main_keep', 'set_upstream', 'cancel'],
  {
    message: 'Must be one of: switch_main_delete, switch_main_keep, set_upstream, cancel',
  }
);

/**
 * Update command options schema
 */
export const updateOptionsSchema = baseOptionsSchema.extend({
  checkOnly: z.boolean().optional(),
  force: z.boolean().optional(),
});

/**
 * Config key argument schema
 * Supports dot notation for nested properties
 */
export const configKeySchema = z
  .string()
  .min(1, 'Configuration key cannot be empty')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Invalid configuration key format');

/**
 * Config value schema
 * Can be string, number, or boolean
 */
export const configValueSchema = z.union([
  z.string().min(1, 'Configuration value cannot be empty'),
  z.number(),
  z.boolean(),
]);

/**
 * Valid banner values
 */
export const bannerValueSchema = z.enum(['full', 'compact', 'none'], {
  message: 'Banner must be one of: full, compact, none',
});

/**
 * Valid theme values
 */
export const themeValueSchema = z.enum(['dark', 'light', 'auto'], {
  message: 'Theme must be one of: dark, light, auto',
});

/**
 * Valid shell types
 */
export const shellTypeSchema = z.enum(['zsh', 'bash', 'fish'], {
  message: 'Shell type must be one of: zsh, bash, fish',
});

/**
 * Alias setup options schema
 */
export const aliasSetupOptionsSchema = baseOptionsSchema.extend({
  force: z.boolean().optional(),
  enable: z.boolean().optional(),
  disable: z.boolean().optional(),
});

/**
 * Type exports for use in commands
 */
export type BaseOptions = z.infer<typeof baseOptionsSchema>;
export type InitOptions = z.infer<typeof initOptionsSchema>;
export type GitPushOptions = z.infer<typeof gitPushOptionsSchema>;
export type GitPullOptions = z.infer<typeof gitPullOptionsSchema>;
export type GitBranchOptions = z.infer<typeof gitBranchOptionsSchema>;
export type UpdateOptions = z.infer<typeof updateOptionsSchema>;
export type ConfigKey = z.infer<typeof configKeySchema>;
export type ConfigValue = z.infer<typeof configValueSchema>;
export type BannerValue = z.infer<typeof bannerValueSchema>;
export type ThemeValue = z.infer<typeof themeValueSchema>;
export type ShellType = z.infer<typeof shellTypeSchema>;
export type AliasSetupOptions = z.infer<typeof aliasSetupOptionsSchema>;
export type DeletedBranchAction = z.infer<typeof deletedBranchActionSchema>;
