import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Single SQLite file backing conversations + customer memory. Uses Node's
 * built-in `node:sqlite` (Node 22+) instead of a native dependency like
 * better-sqlite3, so `npm install` never needs a C++ toolchain — important
 * both for production deploys and for a customer who just wants to run this
 * on their own machine. Swap for Postgres later if multi-instance writes
 * become a requirement; every caller goes through the store interfaces in
 * `conversation/` and `memory/`, not this file directly.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      deal_id TEXT,
      contact_id TEXT,
      mode TEXT NOT NULL,
      manager_active INTEGER NOT NULL,
      focus_product TEXT,
      order_spec TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_deal_id ON conversations (deal_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      attachments TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations (id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id, seq);

    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      entry TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations (id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_logs_conversation_id ON agent_logs (conversation_id, seq);

    CREATE TABLE IF NOT EXISTS customer_memory (
      contact_id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);
  return db;
}
