import sqlite3 from 'sqlite3';
import { nanoid } from 'nanoid';
import { dirname } from 'path';
import { mkdir } from 'fs/promises';
import { promisify } from 'util';
import type {
  ContextItem,
  RawContextItem,
  ContextFilters,
  AddContextOptions,
  ContextPriority,
} from '@/types/agent.js';

/**
 * Database class for managing agent contexts
 */
export class ContextDB {
  private db: sqlite3.Database;
  private ready: Promise<void>;
  private run: (sql: string, ...params: unknown[]) => Promise<void>;
  private get: <T = unknown>(sql: string, ...params: unknown[]) => Promise<T | undefined>;
  private all: <T = unknown>(sql: string, ...params: unknown[]) => Promise<T[]>;

  constructor(dbPath: string) {
    this.db = new sqlite3.Database(dbPath);

    // Promisify database methods
    this.run = promisify(this.db.run.bind(this.db));
    this.get = promisify(this.db.get.bind(this.db));
    this.all = promisify(this.db.all.bind(this.db));

    this.ready = this.initialize();
  }

  /**
   * Async factory to ensure directory exists before opening DB
   */
  static async create(dbPath: string): Promise<ContextDB> {
    await mkdir(dirname(dbPath), { recursive: true });
    return new ContextDB(dbPath);
  }

  /**
   * Ensure database is ready
   */
  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  /**
   * Initialize the database schema
   */
  private async initialize(): Promise<void> {
    // Create contexts table
    await this.run(`
      CREATE TABLE IF NOT EXISTS contexts (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        priority TEXT NOT NULL DEFAULT 'medium',
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL
      )
    `);

    // Create indexes for better query performance
    await this.run(`CREATE INDEX IF NOT EXISTS idx_contexts_priority ON contexts(priority)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_contexts_created_at ON contexts(created_at)`);
  }

  /**
   * Add a new context item
   */
  async addContext(options: AddContextOptions): Promise<ContextItem> {
    await this.ensureReady();

    const now = new Date().toISOString();
    const id = nanoid();
    const tags = JSON.stringify(options.tags || []);
    const priority = options.priority || 'medium';

    await this.run(
      `
      INSERT INTO contexts (id, content, tags, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      id,
      options.content,
      tags,
      priority,
      now,
      now
    );

    return {
      id,
      content: options.content,
      tags: options.tags || [],
      priority,
      created_at: new Date(now),
      updated_at: new Date(now),
    };
  }

  /**
   * List context items with optional filters
   */
  async listContexts(filters?: ContextFilters): Promise<ContextItem[]> {
    await this.ensureReady();

    let query = 'SELECT * FROM contexts WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.priority) {
      query += ' AND priority = ?';
      params.push(filters.priority);
    }

    if (filters?.tag) {
      query += ` AND EXISTS (
        SELECT 1 FROM json_each(contexts.tags)
        WHERE json_each.value = ?
      )`;
      params.push(filters.tag);
    }

    query += ' ORDER BY priority DESC, created_at DESC';

    const rows = await this.all<RawContextItem>(query, ...params);
    return rows.map(this.transformRawContext);
  }

  /**
   * Get a single context item by ID
   */
  async getContext(id: string): Promise<ContextItem | null> {
    await this.ensureReady();

    const row = await this.get<RawContextItem>('SELECT * FROM contexts WHERE id = ?', id);
    return row ? this.transformRawContext(row) : null;
  }

  /**
   * Remove a context item by ID
   */
  async removeContext(id: string): Promise<boolean> {
    await this.ensureReady();

    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM contexts WHERE id = ?', [id], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  /**
   * Update a context item
   */
  async updateContext(
    id: string,
    updates: Partial<AddContextOptions>
  ): Promise<ContextItem | null> {
    await this.ensureReady();

    const existing = await this.getContext(id);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const content = updates.content ?? existing.content;
    const tags = JSON.stringify(updates.tags ?? existing.tags);
    const priority = updates.priority ?? existing.priority;

    await this.run(
      `
      UPDATE contexts 
      SET content = ?, tags = ?, priority = ?, updated_at = ?
      WHERE id = ?
    `,
      content,
      tags,
      priority,
      now,
      id
    );

    return {
      id,
      content,
      tags: updates.tags ?? existing.tags,
      priority,
      created_at: existing.created_at,
      updated_at: new Date(now),
    };
  }

  /**
   * Get context statistics
   */
  async getStats(): Promise<{
    total: number;
    byPriority: Record<ContextPriority, number>;
    totalTags: number;
  }> {
    await this.ensureReady();

    const totalResult = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM contexts');
    const total = totalResult?.count || 0;

    const priorityRows = await this.all<{ priority: ContextPriority; count: number }>(`
      SELECT priority, COUNT(*) as count 
      FROM contexts 
      GROUP BY priority
    `);

    const byPriority: Record<ContextPriority, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    priorityRows.forEach((row) => {
      byPriority[row.priority] = row.count;
    });

    // Count unique tags
    const tagRows = await this.all<{ tags: string }>('SELECT tags FROM contexts');
    const allTags = new Set<string>();

    tagRows.forEach((row) => {
      try {
        const tags = JSON.parse(row.tags) as string[];
        tags.forEach((tag) => allTags.add(tag));
      } catch {
        // Ignore invalid JSON
      }
    });

    return {
      total,
      byPriority,
      totalTags: allTags.size,
    };
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Transform raw database row to ContextItem
   */
  private transformRawContext(raw: RawContextItem): ContextItem {
    let tags: string[] = [];
    try {
      tags = JSON.parse(raw.tags);
    } catch {
      // If JSON parsing fails, leave as empty array
    }

    return {
      id: raw.id,
      content: raw.content,
      tags,
      priority: raw.priority,
      created_at: new Date(raw.created_at),
      updated_at: new Date(raw.updated_at),
    };
  }
}
