/**
 * Long-term signal tracking for Mimamori
 *
 * This module aggregates short-term message data into long-term signals
 * that can detect cumulative patterns like:
 * - Manager A consistently criticizes Employee B
 * - User A's language toward User B is escalating over weeks
 * - Certain users are repeatedly targeted across different contexts
 *
 * Privacy: Only aggregated counts and patterns are stored, not message content.
 */

import type Database from 'better-sqlite3';
import { log } from '../logger.js';

/**
 * Represents a signal between two users
 * Tracks cumulative interaction patterns over time
 */
export interface UserSignal {
  id: number;
  guild_id: string;
  /** The user who initiated the interaction (e.g., the critic) */
  source_user_id: string;
  /** The user who was targeted (e.g., the criticized) */
  target_user_id: string;
  /** Total number of interactions analyzed */
  total_interactions: number;
  /** Number of interactions flagged as concerning */
  concerning_count: number;
  /** Breakdown by issue type (JSON object) */
  issue_breakdown: string;
  /** Breakdown by severity (JSON object) */
  severity_breakdown: string;
  /** Average confidence score of concerning interactions */
  avg_confidence: number;
  /** Trend indicator: -1 (improving), 0 (stable), 1 (worsening) */
  trend: number;
  /** First interaction timestamp */
  first_seen: number;
  /** Most recent interaction timestamp */
  last_seen: number;
  /** Last aggregation timestamp */
  last_aggregated: number;
}

export interface IssueBreakdown {
  discrimination: number;
  harassment: number;
  bullying: number;
  implicit_bias: number;
  labeling: number;
  targeting: number;
  inappropriate: number;
}

export interface SeverityBreakdown {
  low: number;
  medium: number;
  high: number;
}

/**
 * Daily snapshot for trend analysis
 */
export interface DailySnapshot {
  id: number;
  guild_id: string;
  source_user_id: string;
  target_user_id: string;
  date: string; // YYYY-MM-DD format
  interaction_count: number;
  concerning_count: number;
  avg_severity: number; // 1=low, 2=medium, 3=high
  primary_issue_type: string | null;
}

export function createSignalTables(db: Database.Database): void {
  // User signals table - aggregated long-term patterns
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      source_user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      total_interactions INTEGER NOT NULL DEFAULT 0,
      concerning_count INTEGER NOT NULL DEFAULT 0,
      issue_breakdown TEXT NOT NULL DEFAULT '{}',
      severity_breakdown TEXT NOT NULL DEFAULT '{}',
      avg_confidence REAL NOT NULL DEFAULT 0,
      trend INTEGER NOT NULL DEFAULT 0,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      last_aggregated INTEGER NOT NULL,
      UNIQUE(guild_id, source_user_id, target_user_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_signals_source
    ON user_signals (guild_id, source_user_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_signals_target
    ON user_signals (guild_id, target_user_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_signals_concerning
    ON user_signals (guild_id, concerning_count DESC)
  `);

  // Daily snapshots for trend analysis
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      source_user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      interaction_count INTEGER NOT NULL DEFAULT 0,
      concerning_count INTEGER NOT NULL DEFAULT 0,
      avg_severity REAL NOT NULL DEFAULT 0,
      primary_issue_type TEXT,
      UNIQUE(guild_id, source_user_id, target_user_id, date)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_daily_snapshots_date
    ON daily_snapshots (guild_id, date DESC)
  `);

  log.debug('Signal tables created');
}

export class SignalRepository {
  private upsertSignalStmt: Database.Statement;
  private getSignalStmt: Database.Statement;
  private getSignalsBySourceStmt: Database.Statement;
  private getSignalsByTargetStmt: Database.Statement;
  private getTopConcerningStmt: Database.Statement;
  private insertSnapshotStmt: Database.Statement;
  private getRecentSnapshotsStmt: Database.Statement;

  constructor(db: Database.Database) {
    // Create tables if they don't exist
    createSignalTables(db);

    this.upsertSignalStmt = db.prepare(`
      INSERT INTO user_signals
      (guild_id, source_user_id, target_user_id, total_interactions, concerning_count,
       issue_breakdown, severity_breakdown, avg_confidence, trend, first_seen, last_seen, last_aggregated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, source_user_id, target_user_id) DO UPDATE SET
        total_interactions = excluded.total_interactions,
        concerning_count = excluded.concerning_count,
        issue_breakdown = excluded.issue_breakdown,
        severity_breakdown = excluded.severity_breakdown,
        avg_confidence = excluded.avg_confidence,
        trend = excluded.trend,
        last_seen = excluded.last_seen,
        last_aggregated = excluded.last_aggregated
    `);

    this.getSignalStmt = db.prepare(`
      SELECT * FROM user_signals
      WHERE guild_id = ? AND source_user_id = ? AND target_user_id = ?
    `);

    this.getSignalsBySourceStmt = db.prepare(`
      SELECT * FROM user_signals
      WHERE guild_id = ? AND source_user_id = ?
      ORDER BY concerning_count DESC
    `);

    this.getSignalsByTargetStmt = db.prepare(`
      SELECT * FROM user_signals
      WHERE guild_id = ? AND target_user_id = ?
      ORDER BY concerning_count DESC
    `);

    this.getTopConcerningStmt = db.prepare(`
      SELECT * FROM user_signals
      WHERE guild_id = ? AND concerning_count >= ?
      ORDER BY concerning_count DESC, last_seen DESC
      LIMIT ?
    `);

    this.insertSnapshotStmt = db.prepare(`
      INSERT OR REPLACE INTO daily_snapshots
      (guild_id, source_user_id, target_user_id, date, interaction_count,
       concerning_count, avg_severity, primary_issue_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.getRecentSnapshotsStmt = db.prepare(`
      SELECT * FROM daily_snapshots
      WHERE guild_id = ? AND source_user_id = ? AND target_user_id = ?
      ORDER BY date DESC
      LIMIT ?
    `);
  }

  /**
   * Update or create a signal between two users
   */
  upsertSignal(signal: Omit<UserSignal, 'id'>): void {
    this.upsertSignalStmt.run(
      signal.guild_id,
      signal.source_user_id,
      signal.target_user_id,
      signal.total_interactions,
      signal.concerning_count,
      signal.issue_breakdown,
      signal.severity_breakdown,
      signal.avg_confidence,
      signal.trend,
      signal.first_seen,
      signal.last_seen,
      signal.last_aggregated
    );
  }

  /**
   * Get signal between two specific users
   */
  getSignal(guildId: string, sourceUserId: string, targetUserId: string): UserSignal | undefined {
    return this.getSignalStmt.get(guildId, sourceUserId, targetUserId) as UserSignal | undefined;
  }

  /**
   * Get all signals where a user is the source (initiator)
   */
  getSignalsBySource(guildId: string, sourceUserId: string): UserSignal[] {
    return this.getSignalsBySourceStmt.all(guildId, sourceUserId) as UserSignal[];
  }

  /**
   * Get all signals where a user is the target
   */
  getSignalsByTarget(guildId: string, targetUserId: string): UserSignal[] {
    return this.getSignalsByTargetStmt.all(guildId, targetUserId) as UserSignal[];
  }

  /**
   * Get top concerning user pairs in a guild
   */
  getTopConcerning(guildId: string, minConcerning = 3, limit = 10): UserSignal[] {
    return this.getTopConcerningStmt.all(guildId, minConcerning, limit) as UserSignal[];
  }

  /**
   * Record a daily snapshot for trend analysis
   */
  recordSnapshot(snapshot: Omit<DailySnapshot, 'id'>): void {
    this.insertSnapshotStmt.run(
      snapshot.guild_id,
      snapshot.source_user_id,
      snapshot.target_user_id,
      snapshot.date,
      snapshot.interaction_count,
      snapshot.concerning_count,
      snapshot.avg_severity,
      snapshot.primary_issue_type
    );
  }

  /**
   * Get recent snapshots for trend calculation
   */
  getRecentSnapshots(
    guildId: string,
    sourceUserId: string,
    targetUserId: string,
    days = 30
  ): DailySnapshot[] {
    return this.getRecentSnapshotsStmt.all(guildId, sourceUserId, targetUserId, days) as DailySnapshot[];
  }
}

/**
 * Calculate trend from recent snapshots
 * Returns: -1 (improving), 0 (stable), 1 (worsening)
 */
export function calculateTrend(snapshots: DailySnapshot[]): number {
  if (snapshots.length < 7) {
    return 0; // Not enough data
  }

  // Compare last 7 days to previous 7 days
  const recent = snapshots.slice(0, 7);
  const previous = snapshots.slice(7, 14);

  if (previous.length < 7) {
    return 0; // Not enough historical data
  }

  const recentAvg = recent.reduce((sum, s) => sum + s.concerning_count, 0) / recent.length;
  const previousAvg = previous.reduce((sum, s) => sum + s.concerning_count, 0) / previous.length;

  const change = recentAvg - previousAvg;

  if (change > 0.5) return 1;  // Worsening
  if (change < -0.5) return -1; // Improving
  return 0; // Stable
}

/**
 * Format signal data for AI context
 */
export function formatSignalForContext(signal: UserSignal, sourceUserName?: string, targetUserName?: string): string {
  const sourceName = sourceUserName ?? signal.source_user_id;
  const targetName = targetUserName ?? signal.target_user_id;

  const issueBreakdown = JSON.parse(signal.issue_breakdown) as IssueBreakdown;
  const severityBreakdown = JSON.parse(signal.severity_breakdown) as SeverityBreakdown;

  const lines: string[] = [];
  lines.push(`=== Long-term Pattern: ${sourceName} → ${targetName} ===`);
  lines.push(`Total interactions analyzed: ${String(signal.total_interactions)}`);
  lines.push(`Concerning interactions: ${String(signal.concerning_count)} (${String(Math.round(signal.concerning_count / signal.total_interactions * 100))}%)`);

  // Trend indicator
  const trendText = signal.trend === 1 ? '📈 WORSENING' : signal.trend === -1 ? '📉 Improving' : '➡️ Stable';
  lines.push(`Trend: ${trendText}`);

  // Issue breakdown (only show non-zero)
  const issues = Object.entries(issueBreakdown)
    .filter(([_, count]) => (count as number) > 0)
    .map(([type, count]) => `${type}: ${String(count)}`)
    .join(', ');
  if (issues) {
    lines.push(`Issue types: ${issues}`);
  }

  // Severity breakdown
  const severities = Object.entries(severityBreakdown)
    .filter(([_, count]) => (count as number) > 0)
    .map(([level, count]) => `${level}: ${String(count)}`)
    .join(', ');
  if (severities) {
    lines.push(`Severity: ${severities}`);
  }

  // Time range
  const firstDate = new Date(signal.first_seen).toLocaleDateString();
  const lastDate = new Date(signal.last_seen).toLocaleDateString();
  lines.push(`Period: ${firstDate} - ${lastDate}`);

  return lines.join('\n');
}
