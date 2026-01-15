import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { dirname } from 'path';
import { mkdir } from 'fs/promises';
import type {
  ContextItem,
  RawContextItem,
  ContextFilters,
  AddContextOptions,
  ContextPriority,
} from '@/types/agent.js';

/**
 * Database class for managing agent contexts.
 * Uses async factory pattern since better-sqlite3 is synchronous.
 */
export class ContextDB {
  private db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Async factory to ensure directory exists before opening DB
   */
  static async create(dbPath: string): Promise<ContextDB> {
    await mkdir(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);

    // Initialize schema synchronously since better-sqlite3 is sync
    db.exec(`
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
    db.exec(`CREATE INDEX IF NOT EXISTS idx_contexts_priority ON contexts(priority)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_contexts_created_at ON contexts(created_at)`);

    return new ContextDB(db);
  }

  /**
   * Add a new context item
   */
  addContext(options: AddContextOptions): ContextItem {
    const now = new Date().toISOString();
    const id = nanoid();
    const tags = JSON.stringify(options.tags || []);
    const priority = options.priority || 'medium';

    const stmt = this.db.prepare(`
      INSERT INTO contexts (id, content, tags, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, options.content, tags, priority, now, now);

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
  listContexts(filters?: ContextFilters): ContextItem[] {
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

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as RawContextItem[];
    return rows.map(this.transformRawContext);
  }

  /**
   * Get a single context item by ID
   */
  getContext(id: string): ContextItem | null {
    const stmt = this.db.prepare('SELECT * FROM contexts WHERE id = ?');
    const row = stmt.get(id) as RawContextItem | undefined;
    return row ? this.transformRawContext(row) : null;
  }

  /**
   * Remove a context item by ID
   */
  removeContext(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM contexts WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Update a context item
   */
  updateContext(id: string, updates: Partial<AddContextOptions>): ContextItem | null {
    const existing = this.getContext(id);
    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const content = updates.content ?? existing.content;
    const tags = JSON.stringify(updates.tags ?? existing.tags);
    const priority = updates.priority ?? existing.priority;

    const stmt = this.db.prepare(`
      UPDATE contexts
      SET content = ?, tags = ?, priority = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(content, tags, priority, now, id);

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
  getStats(): {
    total: number;
    byPriority: Record<ContextPriority, number>;
    totalTags: number;
  } {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM contexts');
    const totalResult = totalStmt.get() as { count: number } | undefined;
    const total = totalResult?.count || 0;

    const priorityStmt = this.db.prepare(`
      SELECT priority, COUNT(*) as count
      FROM contexts
      GROUP BY priority
    `);
    const priorityRows = priorityStmt.all() as { priority: ContextPriority; count: number }[];

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
    const tagStmt = this.db.prepare('SELECT tags FROM contexts');
    const tagRows = tagStmt.all() as { tags: string }[];
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
  close(): void {
    this.db.close();
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
