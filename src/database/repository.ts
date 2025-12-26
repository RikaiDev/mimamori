/**
 * Database repository for Mimamori
 * Handles all CRUD operations for messages, interactions, and alerts
 */

import type Database from 'better-sqlite3';
import { log } from '../logger.js';

// Type definitions
export interface StoredMessage {
  id: string;
  guild_id: string;
  channel_id: string;
  author_id: string;
  content: string;
  timestamp: number;
  reply_to_id: string | null;
  reply_to_author_id: string | null;
  mentions: string; // JSON array of user IDs
  created_at: number;
}

export interface Interaction {
  id: number;
  guild_id: string;
  user_a_id: string;
  user_b_id: string;
  last_interaction_at: number;
  interaction_count: number;
  context_chain: string; // JSON array
}

export interface Alert {
  id: number;
  message_id: string;
  guild_id: string;
  channel_id: string;
  author_id: string;
  alerted_at: number;
  severity: string;
  reason: string | null;
}

export interface ContextMessage {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  timestamp: number;
  reply_to_id: string | null;
  reply_to_author_id: string | null;
  mentions: string[];
}

export class MessageRepository {
  private insertStmt: Database.Statement;
  private getByIdStmt: Database.Statement;
  private getByAuthorStmt: Database.Statement;
  private getByChannelStmt: Database.Statement;
  private getContextStmt: Database.Statement;
  private deleteOldStmt: Database.Statement;

  constructor(db: Database.Database) {

    // Prepare statements for better performance
    this.insertStmt = db.prepare(`
      INSERT OR REPLACE INTO messages
      (id, guild_id, channel_id, author_id, content, timestamp, reply_to_id, reply_to_author_id, mentions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getByIdStmt = db.prepare(`
      SELECT * FROM messages WHERE id = ?
    `);

    this.getByAuthorStmt = db.prepare(`
      SELECT * FROM messages
      WHERE guild_id = ? AND author_id = ? AND timestamp >= ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    this.getByChannelStmt = db.prepare(`
      SELECT * FROM messages
      WHERE channel_id = ? AND timestamp >= ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    this.getContextStmt = db.prepare(`
      SELECT * FROM messages
      WHERE guild_id = ? AND timestamp >= ?
      AND (author_id = ? OR author_id = ? OR mentions LIKE ? OR mentions LIKE ?)
      ORDER BY timestamp ASC
      LIMIT ?
    `);

    this.deleteOldStmt = db.prepare(`
      DELETE FROM messages WHERE timestamp < ?
    `);
  }

  insert(message: Omit<StoredMessage, 'created_at'>): void {
    this.insertStmt.run(
      message.id,
      message.guild_id,
      message.channel_id,
      message.author_id,
      message.content,
      message.timestamp,
      message.reply_to_id,
      message.reply_to_author_id,
      message.mentions
    );
  }

  getById(id: string): StoredMessage | undefined {
    return this.getByIdStmt.get(id) as StoredMessage | undefined;
  }

  getByAuthor(guildId: string, authorId: string, sinceTimestamp: number, limit = 50): StoredMessage[] {
    return this.getByAuthorStmt.all(guildId, authorId, sinceTimestamp, limit) as StoredMessage[];
  }

  getByChannel(channelId: string, sinceTimestamp: number, limit = 50): StoredMessage[] {
    return this.getByChannelStmt.all(channelId, sinceTimestamp, limit) as StoredMessage[];
  }

  /**
   * Get context messages involving two users
   * Used for building cross-channel context for analysis
   */
  getContextBetweenUsers(
    guildId: string,
    userAId: string,
    userBId: string,
    sinceTimestamp: number,
    limit = 100
  ): ContextMessage[] {
    const messages = this.getContextStmt.all(
      guildId,
      sinceTimestamp,
      userAId,
      userBId,
      `%"${userAId}"%`,
      `%"${userBId}"%`,
      limit
    ) as StoredMessage[];

    return messages.map((msg) => ({
      id: msg.id,
      channel_id: msg.channel_id,
      author_id: msg.author_id,
      content: msg.content,
      timestamp: msg.timestamp,
      reply_to_id: msg.reply_to_id,
      reply_to_author_id: msg.reply_to_author_id,
      mentions: JSON.parse(msg.mentions) as string[],
    }));
  }

  deleteOlderThan(timestamp: number): number {
    const result = this.deleteOldStmt.run(timestamp);
    return result.changes;
  }
}

export class InteractionRepository {
  private upsertStmt: Database.Statement;
  private getStmt: Database.Statement;
  private getByUserStmt: Database.Statement;

  constructor(db: Database.Database) {

    this.upsertStmt = db.prepare(`
      INSERT INTO interactions (guild_id, user_a_id, user_b_id, last_interaction_at, interaction_count, context_chain)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(guild_id, user_a_id, user_b_id) DO UPDATE SET
        last_interaction_at = excluded.last_interaction_at,
        interaction_count = interaction_count + 1,
        context_chain = excluded.context_chain
    `);

    this.getStmt = db.prepare(`
      SELECT * FROM interactions
      WHERE guild_id = ? AND user_a_id = ? AND user_b_id = ?
    `);

    this.getByUserStmt = db.prepare(`
      SELECT * FROM interactions
      WHERE guild_id = ? AND (user_a_id = ? OR user_b_id = ?)
      AND last_interaction_at >= ?
      ORDER BY last_interaction_at DESC
    `);
  }

  /**
   * Record an interaction between two users
   * User order is normalized (smaller ID first) for consistent lookups
   */
  recordInteraction(
    guildId: string,
    userAId: string,
    userBId: string,
    timestamp: number,
    contextChain: string[]
  ): void {
    // Normalize user order for consistent lookups
    const [first, second] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
    this.upsertStmt.run(guildId, first, second, timestamp, JSON.stringify(contextChain));
  }

  get(guildId: string, userAId: string, userBId: string): Interaction | undefined {
    const [first, second] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
    return this.getStmt.get(guildId, first, second) as Interaction | undefined;
  }

  getByUser(guildId: string, userId: string, sinceTimestamp: number): Interaction[] {
    return this.getByUserStmt.all(guildId, userId, userId, sinceTimestamp) as Interaction[];
  }
}

export class AlertRepository {
  private insertStmt: Database.Statement;
  private getByMessageStmt: Database.Statement;
  private getByAuthorStmt: Database.Statement;
  private getRecentByAuthorStmt: Database.Statement;

  constructor(db: Database.Database) {

    this.insertStmt = db.prepare(`
      INSERT OR IGNORE INTO alerts
      (message_id, guild_id, channel_id, author_id, severity, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.getByMessageStmt = db.prepare(`
      SELECT * FROM alerts WHERE message_id = ?
    `);

    this.getByAuthorStmt = db.prepare(`
      SELECT * FROM alerts
      WHERE author_id = ?
      ORDER BY alerted_at DESC
      LIMIT ?
    `);

    this.getRecentByAuthorStmt = db.prepare(`
      SELECT * FROM alerts
      WHERE author_id = ? AND alerted_at >= ?
      ORDER BY alerted_at DESC
    `);
  }

  insert(alert: Omit<Alert, 'id' | 'alerted_at'>): boolean {
    const result = this.insertStmt.run(
      alert.message_id,
      alert.guild_id,
      alert.channel_id,
      alert.author_id,
      alert.severity,
      alert.reason
    );
    return result.changes > 0;
  }

  getByMessage(messageId: string): Alert | undefined {
    return this.getByMessageStmt.get(messageId) as Alert | undefined;
  }

  getByAuthor(authorId: string, limit = 10): Alert[] {
    return this.getByAuthorStmt.all(authorId, limit) as Alert[];
  }

  /**
   * Check if user has been alerted recently (for cooldown)
   */
  hasRecentAlert(authorId: string, sinceTimestamp: number): boolean {
    const alerts = this.getRecentByAuthorStmt.all(authorId, sinceTimestamp) as Alert[];
    return alerts.length > 0;
  }
}

/**
 * Database manager - singleton that holds all repositories
 */
export class DatabaseManager {
  private db: Database.Database;
  readonly messages: MessageRepository;
  readonly interactions: InteractionRepository;
  readonly alerts: AlertRepository;

  constructor(db: Database.Database) {
    this.db = db;
    this.messages = new MessageRepository(db);
    this.interactions = new InteractionRepository(db);
    this.alerts = new AlertRepository(db);
  }

  /**
   * Clean up old messages based on retention policy
   */
  cleanupOldMessages(retentionHours: number): number {
    const cutoffTimestamp = Date.now() - retentionHours * 60 * 60 * 1000;
    const deleted = this.messages.deleteOlderThan(cutoffTimestamp);
    if (deleted > 0) {
      log.info(`Cleaned up ${String(deleted)} messages older than ${String(retentionHours)} hours`);
    }
    return deleted;
  }

  close(): void {
    this.db.close();
    log.info('Database connection closed');
  }
}
