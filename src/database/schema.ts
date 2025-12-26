/**
 * SQLite database schema for Mimamori
 */

import Database from 'better-sqlite3';
import { log } from '../logger.js';

export function initializeDatabase(dbPath: string): Database.Database {
  log.info(`Initializing database at ${dbPath}`);

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');

  // Create tables
  createTables(db);

  log.info('Database initialized successfully');
  return db;
}

function createTables(db: Database.Database): void {
  // Messages table - stores all messages for context building
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      reply_to_id TEXT,
      reply_to_author_id TEXT,
      mentions TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // Index for efficient context queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_guild_timestamp
    ON messages (guild_id, timestamp DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_author_timestamp
    ON messages (author_id, timestamp DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_channel_timestamp
    ON messages (channel_id, timestamp DESC)
  `);

  // Interactions table - tracks user-to-user interactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_a_id TEXT NOT NULL,
      user_b_id TEXT NOT NULL,
      last_interaction_at INTEGER NOT NULL,
      interaction_count INTEGER NOT NULL DEFAULT 1,
      context_chain TEXT DEFAULT '[]',
      UNIQUE(guild_id, user_a_id, user_b_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_interactions_users
    ON interactions (guild_id, user_a_id, user_b_id)
  `);

  // Alerts table - records sent notifications to prevent duplicates
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      alerted_at INTEGER NOT NULL DEFAULT (unixepoch()),
      severity TEXT NOT NULL,
      reason TEXT,
      UNIQUE(message_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_alerts_author
    ON alerts (author_id, alerted_at DESC)
  `);

  log.debug('Database tables created');
}
