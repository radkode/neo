import { nanoid } from 'nanoid';
import { dirname } from 'path';
import { mkdir, lstat, open } from 'fs/promises';
import {
  constants,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import type {
  ContextItem,
  ContextFilters,
  AddContextOptions,
  ContextPriority,
} from '@/types/agent.js';

/**
 * JSON-backed agent context store.
 *
 * The store keeps the full collection in memory and rewrites the file on each
 * mutation via an atomic rename. The dataset is small (user-authored notes for
 * AI agents), so the simplicity is worth more than per-row durability.
 *
 * Class name + public surface intentionally match the prior SQLite-backed
 * implementation so callers don't change.
 */

interface PersistedShape {
  version: 1;
  contexts: PersistedContext[];
}

interface PersistedContext {
  id: string;
  content: string;
  tags: string[];
  priority: ContextPriority;
  created_at: string;
  updated_at: string;
}

const PRIORITY_RANK: Record<ContextPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function assertSafeContextDirectories(path: string, allowMissing = false): void {
  const directory = dirname(path);
  for (const candidate of [dirname(directory), directory]) {
    try {
      if (!lstatSync(candidate).isDirectory()) {
        throw new Error(`Unsafe context directory: ${candidate}`);
      }
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
}

export class ContextDB {
  private constructor(
    private readonly path: string,
    private contexts: PersistedContext[]
  ) {}

  static async create(path: string): Promise<ContextDB> {
    const directory = dirname(path);
    assertSafeContextDirectories(path, true);
    await mkdir(directory, { recursive: true });
    assertSafeContextDirectories(path);

    let contexts: PersistedContext[] = [];
    const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (entry) {
      if (!entry.isFile()) throw new Error(`Unsafe context file: ${path}`);
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let raw: string;
      try {
        const opened = await file.stat();
        if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino) {
          throw new Error(`Unsafe context file: ${path}`);
        }
        raw = await file.readFile('utf-8');
      } finally {
        await file.close();
      }
      const parsed = JSON.parse(raw) as PersistedShape | PersistedContext[];
      contexts = Array.isArray(parsed) ? parsed : (parsed.contexts ?? []);
    }

    return new ContextDB(path, contexts);
  }

  addContext(options: AddContextOptions): ContextItem {
    const now = new Date().toISOString();
    const record: PersistedContext = {
      id: nanoid(),
      content: options.content,
      tags: options.tags ?? [],
      priority: options.priority ?? 'medium',
      created_at: now,
      updated_at: now,
    };

    this.contexts.push(record);
    this.persist();

    return this.toItem(record);
  }

  listContexts(filters?: ContextFilters): ContextItem[] {
    let rows = this.contexts.slice();

    if (filters?.priority) {
      const wanted = filters.priority;
      rows = rows.filter((r) => r.priority === wanted);
    }

    if (filters?.tag) {
      const wanted = filters.tag;
      rows = rows.filter((r) => r.tags.includes(wanted));
    }

    rows.sort((a, b) => {
      const rankDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
      if (rankDiff !== 0) return rankDiff;
      return b.created_at.localeCompare(a.created_at);
    });

    return rows.map((r) => this.toItem(r));
  }

  getContext(id: string): ContextItem | null {
    const row = this.contexts.find((r) => r.id === id);
    return row ? this.toItem(row) : null;
  }

  removeContext(id: string): boolean {
    const idx = this.contexts.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.contexts.splice(idx, 1);
    this.persist();
    return true;
  }

  updateContext(id: string, updates: Partial<AddContextOptions>): ContextItem | null {
    const row = this.contexts.find((r) => r.id === id);
    if (!row) return null;

    if (updates.content !== undefined) row.content = updates.content;
    if (updates.tags !== undefined) row.tags = updates.tags;
    if (updates.priority !== undefined) row.priority = updates.priority;
    row.updated_at = new Date().toISOString();

    this.persist();
    return this.toItem(row);
  }

  getStats(): {
    total: number;
    byPriority: Record<ContextPriority, number>;
    totalTags: number;
  } {
    const byPriority: Record<ContextPriority, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    const allTags = new Set<string>();

    for (const row of this.contexts) {
      byPriority[row.priority]++;
      for (const tag of row.tags) allTags.add(tag);
    }

    return {
      total: this.contexts.length,
      byPriority,
      totalTags: allTags.size,
    };
  }

  /**
   * No-op kept for source compatibility with the prior SQLite-backed class.
   * JSON persistence is flushed synchronously after each mutation.
   */
  close(): void {}

  private toItem(row: PersistedContext): ContextItem {
    return {
      id: row.id,
      content: row.content,
      tags: row.tags.slice(),
      priority: row.priority,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }

  private persist(): void {
    const payload: PersistedShape = { version: 1, contexts: this.contexts };
    assertSafeContextDirectories(this.path);

    const tmp = `${this.path}.${nanoid()}.tmp`;
    const fd = openSync(
      tmp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600
    );
    try {
      try {
        writeFileSync(fd, JSON.stringify(payload, null, 2), 'utf-8');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }

      assertSafeContextDirectories(this.path);
      try {
        if (!lstatSync(this.path).isFile()) {
          throw new Error(`Unsafe context file: ${this.path}`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      renameSync(tmp, this.path);
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new AggregateError([error, cleanupError], 'Failed to clean up context write', {
            cause: cleanupError,
          });
        }
      }
      throw error;
    }
  }
}
