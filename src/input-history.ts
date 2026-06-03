// Persistent input history — backed by SQLite so it survives restarts.
//
// Stores the last N unique user-typed strings (deduping consecutive repeats
// and skipping empty/whitespace-only). Per-session history is supported: the
// same physical line can be reused in different sessions and is tracked
// independently, so ↑ in a new session doesn't immediately resurface text
// from a previous one.

import { getDb } from './store.js';

const DEFAULT_MAX = 200;

interface HistoryRow {
  value: string;
  session_id: string;
  used_at: number;
}

class InputHistory {
  /** Per-session ring buffer (oldest → newest). */
  private cache = new Map<string, string[]>();
  private maxPerSession = DEFAULT_MAX;
  /** Track the last value typed so we can dedupe consecutive duplicates. */
  private lastBySession = new Map<string, string>();

  /**
   * Reload from SQLite. Call once at startup. If a sessionId is given, only
   * that session's history is warmed; pass nothing (or '*') to warm everything.
   */
  reload(sessionId?: string): void {
    const d = getDb();
    if (sessionId) {
      const rows = d
        .prepare(
          `SELECT value, session_id, used_at FROM input_history
            WHERE session_id = ? ORDER BY used_at ASC`
        )
        .all(sessionId) as HistoryRow[];
      this.cache.set(
        sessionId,
        rows.map((r) => r.value)
      );
    } else {
      const rows = d
        .prepare(
          `SELECT value, session_id, used_at FROM input_history
            ORDER BY session_id, used_at ASC`
        )
        .all() as HistoryRow[];
      this.cache.clear();
      for (const r of rows) {
        const list = this.cache.get(r.session_id) ?? [];
        list.push(r.value);
        this.cache.set(r.session_id, list);
      }
    }
  }

  /** Look up the n-th previous entry (0 = most recent). */
  get(sessionId: string, n: number): string | undefined {
    const list = this.cache.get(sessionId) ?? [];
    if (n < 0 || n >= list.length) return undefined;
    return list[list.length - 1 - n];
  }

  /** Number of entries currently cached for a session. */
  size(sessionId: string): number {
    return (this.cache.get(sessionId) ?? []).length;
  }

  /**
   * Record a value just sent by the user. Trims, skips empty, dedupes
   * consecutive duplicates. Persists to SQLite.
   */
  push(sessionId: string, value: string): void {
    const v = value.replace(/\s+$/, '').trim();
    if (!v) return;
    const last = this.lastBySession.get(sessionId);
    if (last === v) return;

    const list = this.cache.get(sessionId) ?? [];
    list.push(v);
    if (list.length > this.maxPerSession) {
      const dropped = list.shift()!;
      this.persistDrop(sessionId, dropped);
    }
    this.cache.set(sessionId, list);
    this.lastBySession.set(sessionId, v);
    this.persistPush(sessionId, v);
  }

  /** Test-only: clear the entire history (memory + disk). */
  clearAll(): void {
    this.cache.clear();
    this.lastBySession.clear();
    try {
      getDb().exec(`DELETE FROM input_history`);
    } catch {
      /* table might not exist yet — see ensureSchema */
    }
  }

  /** Test-only: clear one session. */
  clearSession(sessionId: string): void {
    this.cache.delete(sessionId);
    this.lastBySession.delete(sessionId);
    try {
      getDb()
        .prepare(`DELETE FROM input_history WHERE session_id = ?`)
        .run(sessionId);
    } catch {
      /* table might not exist yet */
    }
  }

  private persistPush(sessionId: string, value: string): void {
    try {
      this.ensureSchema();
      getDb()
        .prepare(
          `INSERT INTO input_history (value, session_id, used_at)
           VALUES (?, ?, ?)`
        )
        .run(value, sessionId, Date.now());
    } catch {
      /* swallow — history is non-critical */
    }
  }

  private persistDrop(sessionId: string, value: string): void {
    try {
      getDb()
        .prepare(
          `DELETE FROM input_history
            WHERE session_id = ? AND value = ?
            ORDER BY used_at ASC LIMIT 1`
        )
        .run(sessionId, value);
    } catch {
      /* ignore */
    }
  }

  /** Idempotent — adds the table if it doesn't exist. */
  ensureSchema(): void {
    const d = getDb();
    d.exec(`
      CREATE TABLE IF NOT EXISTS input_history (
        value TEXT NOT NULL,
        session_id TEXT NOT NULL,
        used_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_input_history_session
        ON input_history(session_id, used_at);
    `);
  }
}

export const inputHistory = new InputHistory();
