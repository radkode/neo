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
 * Valid conventional commit types
 */
export const commitTypeSchema = z.enum(
  ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore'],
  {
    message: 'Type must be one of: feat, fix, docs, style, refactor, test, chore',
  }
);

/**
 * Commit scope schema
 * Must be lowercase with hyphens allowed
 */
export const commitScopeSchema = z
  .string()
  .min(1, 'Scope cannot be empty')
  .regex(/^[a-z][a-z0-9-]*$/, 'Scope must be lowercase and alphanumeric with hyphens')
  .optional();

/**
 * Commit message description schema
 * Subject line should be concise
 */
export const commitMessageSchema = z
  .string()
  .min(1, 'Commit message cannot be empty')
  .max(100, 'Commit message too long (max 100 characters)');

/**
 * Git commit command options schema
 */
export const gitCommitOptionsSchema = baseOptionsSchema.extend({
  type: commitTypeSchema.optional(),
  scope: commitScopeSchema,
  message: commitMessageSchema.optional(),
  body: z.string().optional(),
  breaking: z.boolean().optional(),
  all: z.boolean().optional(),
  ai: z.boolean().optional(),
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
 * AI API key schema
 * Validates Anthropic API key format
 */
export const aiApiKeySchema = z
  .string()
  .min(1, 'API key cannot be empty')
  .regex(/^sk-ant-/, 'API key must start with sk-ant-');

/**
 * Valid AI model values
 */
export const aiModelSchema = z.enum(
  ['claude-3-haiku-20240307', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
  {
    message: 'Model must be a valid Claude model identifier',
  }
);

/**
 * Alias setup options schema
 */
export const aliasSetupOptionsSchema = baseOptionsSchema.extend({
  force: z.boolean().optional(),
  enable: z.boolean().optional(),
  disable: z.boolean().optional(),
});

/**
 * Agent init command options schema
 */
export const agentInitOptionsSchema = baseOptionsSchema.extend({
  project: z.string().min(1, 'Project name cannot be empty').optional(),
  force: z.boolean().optional(),
});

/**
 * Agent context add command options schema
 */
export const agentContextAddOptionsSchema = baseOptionsSchema.extend({
  tag: z.array(z.string().min(1, 'Tag cannot be empty')).optional(),
  priority: z
    .enum(['low', 'medium', 'high', 'critical'], {
      message: 'Priority must be one of: low, medium, high, critical',
    })
    .optional(),
});

/**
 * Agent context list command options schema
 */
export const agentContextListOptionsSchema = baseOptionsSchema.extend({
  tag: z.string().min(1, 'Tag cannot be empty').optional(),
  priority: z
    .enum(['low', 'medium', 'high', 'critical'], {
      message: 'Priority must be one of: low, medium, high, critical',
    })
    .optional(),
});

/**
 * Agent context remove command argument schema
 */
export const contextIdSchema = z
  .string()
  .min(1, 'Context ID cannot be empty')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid context ID format');

/**
 * Agent context content schema
 */
export const contextContentSchema = z
  .string()
  .min(1, 'Context content cannot be empty')
  .max(5000, 'Context content too long (max 5000 characters)');

/**
 * Type exports for use in commands
 */
export type BaseOptions = z.infer<typeof baseOptionsSchema>;
export type InitOptions = z.infer<typeof initOptionsSchema>;
export type GitPushOptions = z.infer<typeof gitPushOptionsSchema>;
export type GitPullOptions = z.infer<typeof gitPullOptionsSchema>;
export type GitBranchOptions = z.infer<typeof gitBranchOptionsSchema>;
export type GitCommitOptions = z.infer<typeof gitCommitOptionsSchema>;
export type CommitType = z.infer<typeof commitTypeSchema>;
export type UpdateOptions = z.infer<typeof updateOptionsSchema>;
export type ConfigKey = z.infer<typeof configKeySchema>;
export type ConfigValue = z.infer<typeof configValueSchema>;
export type BannerValue = z.infer<typeof bannerValueSchema>;
export type ThemeValue = z.infer<typeof themeValueSchema>;
export type ShellType = z.infer<typeof shellTypeSchema>;
export type AliasSetupOptions = z.infer<typeof aliasSetupOptionsSchema>;
export type DeletedBranchAction = z.infer<typeof deletedBranchActionSchema>;
export type AgentInitOptions = z.infer<typeof agentInitOptionsSchema>;
export type AgentContextAddOptions = z.infer<typeof agentContextAddOptionsSchema>;
export type AgentContextListOptions = z.infer<typeof agentContextListOptionsSchema>;
export type ContextId = z.infer<typeof contextIdSchema>;
export type ContextContent = z.infer<typeof contextContentSchema>;
export type AiApiKey = z.infer<typeof aiApiKeySchema>;
export type AiModel = z.infer<typeof aiModelSchema>;
