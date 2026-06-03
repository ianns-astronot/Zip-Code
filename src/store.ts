// SQLite-backed session and message storage

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { homedir } from 'os';
import type { ChatMessage, Message, ProviderRecord, SessionRow } from './types.js';

const DB_DIR = resolve(homedir(), '.zipcode');
const DB_PATH = resolve(DB_DIR, 'zipcode.db');

let db: Database.Database | null = null;

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getDb(): Database.Database {
  if (db) return db;

  ensureDir(DB_PATH);
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      model TEXT,
      provider TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      name TEXT,
      tool_call_id TEXT,
      tool_calls TEXT,
      tool_name TEXT,
      tool_args TEXT,
      tool_status TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session
      ON messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key TEXT NOT NULL,
      base_url TEXT,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  return db;
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ──────────── sessions ────────────

export function createSession(opts: {
  title?: string;
  model?: string;
  provider?: string;
}): SessionRow {
  const d = getDb();
  const now = Date.now();
  const id = newId('sess');
  const title = opts.title || 'New session';

  d.prepare(
    `INSERT INTO sessions (id, title, created_at, updated_at, model, provider)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, title, now, now, opts.model || '', opts.provider || '');

  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    model: opts.model || '',
    provider: opts.provider || '',
    messageCount: 0,
  };
}

export function listSessions(limit = 50): SessionRow[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT s.id, s.title, s.created_at, s.updated_at, s.model, s.provider,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s
        ORDER BY s.updated_at DESC
        LIMIT ?`
    )
    .all(limit) as any[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    model: r.model,
    provider: r.provider,
    messageCount: r.message_count,
  }));
}

export function getSession(id: string): SessionRow | null {
  const d = getDb();
  const r = d
    .prepare(
      `SELECT s.id, s.title, s.created_at, s.updated_at, s.model, s.provider,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s
        WHERE s.id = ?`
    )
    .get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    model: r.model,
    provider: r.provider,
    messageCount: r.message_count,
  };
}

export function renameSession(id: string, title: string): void {
  const d = getDb();
  d.prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`).run(
    title,
    Date.now(),
    id
  );
}

export function touchSession(id: string): void {
  const d = getDb();
  d.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(
    Date.now(),
    id
  );
}

export function deleteSession(id: string): void {
  const d = getDb();
  d.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
}

// ──────────── messages ────────────

export function appendMessage(
  sessionId: string,
  msg: ChatMessage
): void {
  const d = getDb();
  d.prepare(
    `INSERT OR REPLACE INTO messages
       (id, session_id, role, content, name, tool_call_id, tool_calls,
        tool_name, tool_args, tool_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    msg.id,
    sessionId,
    msg.role,
    msg.content || '',
    null,
    msg.toolCallId || null,
    msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
    msg.toolName || null,
    msg.toolArgs ? JSON.stringify(msg.toolArgs) : null,
    msg.toolStatus || null,
    msg.createdAt
  );
  touchSession(sessionId);
}

export function loadMessages(sessionId: string): ChatMessage[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT id, role, content, tool_call_id, tool_calls, tool_name,
              tool_args, tool_status, created_at
         FROM messages
        WHERE session_id = ?
        ORDER BY created_at ASC`
    )
    .all(sessionId) as any[];

  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
    toolCallId: r.tool_call_id || undefined,
    toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
    toolName: r.tool_name || undefined,
    toolArgs: r.tool_args ? JSON.parse(r.tool_args) : undefined,
    toolStatus: r.tool_status || undefined,
  }));
}

// Convert ChatMessage[] (UI) -> Message[] (LLM API shape)
export function toApiMessages(messages: ChatMessage[]): Message[] {
  return messages.map((m) => {
    const base: Message = {
      role: m.role,
      content: m.content,
    };
    if (m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls;
    }
    if (m.role === 'tool') {
      base.tool_call_id = m.toolCallId;
      base.name = m.toolName;
    }
    return base;
  });
}

// ──────────── app_config ────────────

export function getConfigValue(key: string): string | null {
  const d = getDb();
  const r = d.prepare(`SELECT value FROM app_config WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return r ? r.value : null;
}

export function setConfigValue(key: string, value: string): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO app_config (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, Date.now());
}

export function getAllConfig(): Record<string, string> {
  const d = getDb();
  const rows = d.prepare(`SELECT key, value FROM app_config`).all() as Array<{
    key: string;
    value: string;
  }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ──────────── providers ────────────

export function listProviders(): ProviderRecord[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT id, name, type, api_key, base_url, model, created_at, updated_at
         FROM providers
        ORDER BY created_at ASC`
    )
    .all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    apiKey: r.api_key,
    baseURL: r.base_url || undefined,
    model: r.model,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getProvider(id: string): ProviderRecord | null {
  const d = getDb();
  const r = d
    .prepare(
      `SELECT id, name, type, api_key, base_url, model, created_at, updated_at
         FROM providers
        WHERE id = ?`
    )
    .get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    apiKey: r.api_key,
    baseURL: r.base_url || undefined,
    model: r.model,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function upsertProvider(rec: {
  id?: string;
  name: string;
  type: string;
  apiKey: string;
  baseURL?: string;
  model: string;
}): ProviderRecord {
  const d = getDb();
  const now = Date.now();
  const id = rec.id || newId('prov');
  const existing = rec.id ? getProvider(rec.id) : null;

  d.prepare(
    `INSERT INTO providers (id, name, type, api_key, base_url, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       type = excluded.type,
       api_key = excluded.api_key,
       base_url = excluded.base_url,
       model = excluded.model,
       updated_at = excluded.updated_at`
  ).run(
    id,
    rec.name,
    rec.type,
    rec.apiKey,
    rec.baseURL || null,
    rec.model,
    existing ? existing.createdAt : now,
    now
  );

  return getProvider(id)!;
}

export function deleteProvider(id: string): void {
  const d = getDb();
  d.prepare(`DELETE FROM providers WHERE id = ?`).run(id);
  // If this was the active provider, clear the pointer.
  const active = getConfigValue('activeProviderId');
  if (active === id) {
    d.prepare(`DELETE FROM app_config WHERE key = ?`).run('activeProviderId');
  }
}

/** Update only the `model` column of a provider (used by `/model` command). */
export function updateProviderModel(id: string, model: string): void {
  const d = getDb();
  d.prepare(
    `UPDATE providers SET model = ?, updated_at = ? WHERE id = ?`
  ).run(model, Date.now(), id);
}

export function setActiveProvider(id: string): void {
  setConfigValue('activeProviderId', id);
}

export function getActiveProvider(): ProviderRecord | null {
  const id = getConfigValue('activeProviderId');
  if (!id) return null;
  return getProvider(id);
}
