/**
 * Agent-specific types and interfaces
 */

/**
 * Priority levels for context items
 */
export type ContextPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Context item stored in the database
 */
export interface ContextItem {
  /** Unique identifier (nanoid) */
  id: string;
  /** The context content/description */
  content: string;
  /** Array of tags for categorization */
  tags: string[];
  /** Priority level */
  priority: ContextPriority;
  /** Creation timestamp */
  created_at: Date;
  /** Last update timestamp */
  updated_at: Date;
}

/**
 * Raw context item as stored in SQLite (with JSON strings)
 */
export interface RawContextItem {
  id: string;
  content: string;
  tags: string; // JSON string
  priority: ContextPriority;
  created_at: string; // ISO string
  updated_at: string; // ISO string
}

/**
 * Agent project configuration
 */
export interface AgentConfig {
  /** Project name */
  name: string;
  /** Configuration creation timestamp */
  created_at: Date;
  /** Agent preferences */
  agent_preferences?: {
    /** Default AI agent to use */
    default_agent?: 'claude' | 'gpt4';
    /** Maximum context tokens to use */
    max_context_tokens?: number;
  };
}

/**
 * Raw agent config as stored in JSON file
 */
export interface RawAgentConfig {
  name: string;
  created_at: string; // ISO string
  agent_preferences?: {
    default_agent?: 'claude' | 'gpt4';
    max_context_tokens?: number;
  };
}

/**
 * Filter options for listing contexts
 */
export interface ContextFilters {
  /** Filter by tag */
  tag?: string;
  /** Filter by priority */
  priority?: ContextPriority;
}

/**
 * Options for adding new context
 */
export interface AddContextOptions {
  /** Context content */
  content: string;
  /** Tags to assign */
  tags?: string[];
  /** Priority level */
  priority?: ContextPriority;
}
