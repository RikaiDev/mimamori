/**
 * Types for notification actions
 */

import type { AnalysisResult } from '../analyzer/types.js';

export interface NotificationContext {
  guildId: string;
  channelId: string;
  channelName: string;
  messageId: string;
  authorId: string;
  authorName: string;
  targetName?: string;
  messageContent: string;
  analysisResult: AnalysisResult;
}

export interface NotificationResult {
  success: boolean;
  reason?: string;
  skipped?: boolean;
  skipReason?: 'duplicate' | 'cooldown' | 'dm_disabled' | 'not_concerning';
}

export interface NotificationTemplates {
  greeting: string;
  noticed: string;
  explanation: string;
  suggestion: string;
  closing: string;
}
