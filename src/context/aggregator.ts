/**
 * Signal Aggregator for Mimamori
 *
 * Aggregates short-term analysis results into long-term signals.
 * This is the key component for detecting patterns that span days or weeks.
 *
 * Example: A manager might not seem problematic in any single message,
 * but over 2 weeks they've made 15 negative comments about the same employee.
 * The aggregator captures this cumulative pattern.
 */

import type Database from 'better-sqlite3';
import {
  SignalRepository,
  calculateTrend,
  type UserSignal,
  type IssueBreakdown,
  type SeverityBreakdown,
} from '../database/signals.js';
import type { AnalysisResult } from '../analyzer/types.js';
import { log } from '../logger.js';

export interface AggregationResult {
  signalUpdated: boolean;
  signal?: UserSignal;
  isNewConcern: boolean;
  trendChanged: boolean;
}

export class SignalAggregator {
  private signalRepo: SignalRepository;

  constructor(db: Database.Database) {
    this.signalRepo = new SignalRepository(db);
  }

  /**
   * Record an analysis result and update long-term signals
   */
  recordAnalysis(
    guildId: string,
    sourceUserId: string,
    targetUserId: string,
    result: AnalysisResult
  ): AggregationResult {
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0] ?? '';

    // Get existing signal or create new one
    const existingSignal = this.signalRepo.getSignal(guildId, sourceUserId, targetUserId);

    // Initialize or update breakdown objects
    let issueBreakdown: IssueBreakdown = {
      discrimination: 0,
      harassment: 0,
      bullying: 0,
      implicit_bias: 0,
      labeling: 0,
      targeting: 0,
      inappropriate: 0,
    };

    let severityBreakdown: SeverityBreakdown = {
      low: 0,
      medium: 0,
      high: 0,
    };

    let totalInteractions = 0;
    let concerningCount = 0;
    let totalConfidence = 0;
    let firstSeen = now;
    let previousTrend = 0;

    if (existingSignal) {
      issueBreakdown = JSON.parse(existingSignal.issue_breakdown) as IssueBreakdown;
      severityBreakdown = JSON.parse(existingSignal.severity_breakdown) as SeverityBreakdown;
      totalInteractions = existingSignal.total_interactions;
      concerningCount = existingSignal.concerning_count;
      totalConfidence = existingSignal.avg_confidence * existingSignal.concerning_count;
      firstSeen = existingSignal.first_seen;
      previousTrend = existingSignal.trend;
    }

    // Update counts
    totalInteractions++;

    if (result.isConcerning) {
      concerningCount++;
      totalConfidence += result.confidence;

      // Update issue breakdown
      if (result.issueType !== 'none') {
        const issueKey = result.issueType as keyof IssueBreakdown;
        if (issueKey in issueBreakdown) {
          issueBreakdown[issueKey]++;
        }
      }

      // Update severity breakdown
      severityBreakdown[result.severity]++;
    }

    // Calculate new average confidence
    const avgConfidence = concerningCount > 0 ? totalConfidence / concerningCount : 0;

    // Record daily snapshot
    this.signalRepo.recordSnapshot({
      guild_id: guildId,
      source_user_id: sourceUserId,
      target_user_id: targetUserId,
      date: today,
      interaction_count: 1, // This will be accumulated by the daily job
      concerning_count: result.isConcerning ? 1 : 0,
      avg_severity: result.isConcerning ? this.severityToNumber(result.severity) : 0,
      primary_issue_type: result.isConcerning ? result.issueType : null,
    });

    // Calculate trend from snapshots
    const snapshots = this.signalRepo.getRecentSnapshots(guildId, sourceUserId, targetUserId, 30);
    const newTrend = calculateTrend(snapshots);

    // Update signal
    const updatedSignal: Omit<UserSignal, 'id'> = {
      guild_id: guildId,
      source_user_id: sourceUserId,
      target_user_id: targetUserId,
      total_interactions: totalInteractions,
      concerning_count: concerningCount,
      issue_breakdown: JSON.stringify(issueBreakdown),
      severity_breakdown: JSON.stringify(severityBreakdown),
      avg_confidence: avgConfidence,
      trend: newTrend,
      first_seen: firstSeen,
      last_seen: now,
      last_aggregated: now,
    };

    this.signalRepo.upsertSignal(updatedSignal);

    // Check if this crosses a concerning threshold
    const isNewConcern = this.checkConcernThreshold(existingSignal, updatedSignal);
    const trendChanged = previousTrend !== newTrend && newTrend === 1; // Alert on worsening trend

    if (isNewConcern) {
      log.info(`New concerning pattern detected: ${sourceUserId} → ${targetUserId} (${String(concerningCount)} incidents)`);
    }

    if (trendChanged) {
      log.warn(`Pattern worsening: ${sourceUserId} → ${targetUserId}`);
    }

    return {
      signalUpdated: true,
      signal: this.signalRepo.getSignal(guildId, sourceUserId, targetUserId),
      isNewConcern,
      trendChanged,
    };
  }

  /**
   * Get signal context for AI analysis
   * Returns signals that might be relevant to the current interaction
   */
  getSignalContext(guildId: string, sourceUserId: string, targetUserId: string): UserSignal | undefined {
    return this.signalRepo.getSignal(guildId, sourceUserId, targetUserId);
  }

  /**
   * Get all concerning signals involving a user
   * (either as source or target)
   */
  getConcerningSignalsForUser(guildId: string, userId: string): UserSignal[] {
    const asSource = this.signalRepo.getSignalsBySource(guildId, userId);
    const asTarget = this.signalRepo.getSignalsByTarget(guildId, userId);

    // Combine and filter for concerning patterns
    const allSignals = [...asSource, ...asTarget];
    return allSignals.filter((s) => s.concerning_count >= 3 || s.trend === 1);
  }

  /**
   * Get top concerning patterns in a guild
   */
  getTopConcerningPatterns(guildId: string, limit = 10): UserSignal[] {
    return this.signalRepo.getTopConcerning(guildId, 3, limit);
  }

  /**
   * Check if signal crosses a concerning threshold
   */
  private checkConcernThreshold(
    previous: UserSignal | undefined,
    current: Omit<UserSignal, 'id'>
  ): boolean {
    const thresholds = [3, 5, 10, 20]; // Alert at these counts

    for (const threshold of thresholds) {
      const previousCount = previous?.concerning_count ?? 0;
      if (previousCount < threshold && current.concerning_count >= threshold) {
        return true;
      }
    }

    return false;
  }

  private severityToNumber(severity: 'low' | 'medium' | 'high'): number {
    switch (severity) {
      case 'low': return 1;
      case 'medium': return 2;
      case 'high': return 3;
      default: return 0;
    }
  }
}
