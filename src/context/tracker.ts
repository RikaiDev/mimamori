/**
 * Cross-channel context tracker for Mimamori
 *
 * This is the core feature that prevents false positives by understanding
 * conversation flow across different channels.
 *
 * Example scenario:
 * - Manager sees employee's mistake in #project-channel
 * - Manager provides feedback in #private-team
 * - This is legitimate feedback, NOT harassment
 *
 * The tracker builds context by:
 * 1. Finding all recent messages between the two users
 * 2. Including messages across ALL channels (not just the current one)
 * 3. Building a chronological context chain for AI analysis
 */

import type { DatabaseManager, ContextMessage, StoredMessage } from '../database/index.js';
import { getConfig } from '../config.js';
import { log } from '../logger.js';

export interface ContextChain {
  /** The message that triggered the analysis */
  triggerMessage: ContextEntry;
  /** All relevant context messages in chronological order */
  contextMessages: ContextEntry[];
  /** Users involved in this context */
  involvedUsers: string[];
  /** Time span of the context in minutes */
  timeSpanMinutes: number;
}

export interface ContextEntry {
  messageId: string;
  channelId: string;
  channelName?: string;
  authorId: string;
  authorName?: string;
  content: string;
  timestamp: number;
  isReply: boolean;
  isMention: boolean;
  mentionedUsers: string[];
}

export interface AnalysisTrigger {
  shouldAnalyze: boolean;
  reason: string;
  targetUserId?: string; // The user being mentioned/replied to
}

// Negative sentiment keywords that may indicate issues (multi-language)
const NEGATIVE_KEYWORDS = [
  // English
  'stupid', 'idiot', 'incompetent', 'useless', 'pathetic', 'terrible',
  'worst', 'hate', 'disgusting', 'annoying', 'lazy', 'dumb', 'fool',
  'always', 'never', 'again', // Absolute language can indicate frustration
  // Japanese
  'バカ', 'アホ', '無能', '使えない', '最悪', 'ダメ', 'クソ',
  // Chinese
  '笨', '蠢', '廢物', '無能', '白痴', '垃圾', '爛',
];

// Patterns that might indicate discrimination
const DISCRIMINATION_PATTERNS = [
  // Age-related
  /老(人|害|古板)/i,
  /年輕人(就是|都是)/i,
  /old (people|folks|timer)/i,
  /young (people|kids) (are|always)/i,
  // Gender-related
  /女(人|生)(就是|都是|不行)/i,
  /男(人|生)(就是|都是)/i,
  /(women|men|girls|guys) (are|always|never|can't)/i,
  // Nationality/ethnicity (be careful - context matters)
  /(外國人|外籍)(就是|都是)/i,
];

export class ContextTracker {
  private db: DatabaseManager;
  private channelNames = new Map<string, string>();
  private userNames = new Map<string, string>();

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  /**
   * Check if a message should trigger analysis
   */
  checkTrigger(
    content: string,
    authorId: string,
    mentions: string[],
    replyToAuthorId: string | null
  ): AnalysisTrigger {
    // Rule 1: Must mention or reply to someone
    const targetUserId = replyToAuthorId ?? mentions[0];
    if (!targetUserId) {
      return { shouldAnalyze: false, reason: 'No target user (no mention or reply)' };
    }

    // Don't analyze self-mentions
    if (targetUserId === authorId) {
      return { shouldAnalyze: false, reason: 'Self-mention' };
    }

    // Rule 2: Check for negative keywords
    const contentLower = content.toLowerCase();
    const hasNegativeKeyword = NEGATIVE_KEYWORDS.some((keyword) =>
      contentLower.includes(keyword.toLowerCase())
    );

    // Rule 3: Check for discrimination patterns
    const hasDiscriminationPattern = DISCRIMINATION_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasDiscriminationPattern) {
      return {
        shouldAnalyze: true,
        reason: 'Potential discrimination pattern detected',
        targetUserId,
      };
    }

    if (hasNegativeKeyword) {
      return {
        shouldAnalyze: true,
        reason: 'Negative sentiment keyword detected',
        targetUserId,
      };
    }

    // Rule 4: Check message tone (exclamation marks, all caps)
    const hasAggressiveTone =
      (content.match(/!/g)?.length ?? 0) >= 3 ||
      (content.length > 10 && content === content.toUpperCase());

    if (hasAggressiveTone && targetUserId) {
      return {
        shouldAnalyze: true,
        reason: 'Aggressive tone detected',
        targetUserId,
      };
    }

    return { shouldAnalyze: false, reason: 'No concerning patterns detected' };
  }

  /**
   * Build cross-channel context for analysis
   */
  buildContext(
    guildId: string,
    triggerMessageId: string,
    authorId: string,
    targetUserId: string
  ): ContextChain | null {
    const config = getConfig();
    const contextWindowMs = config.contextWindowHours * 60 * 60 * 1000;
    const sinceTimestamp = Date.now() - contextWindowMs;

    // Get the trigger message
    const triggerMessage = this.db.messages.getById(triggerMessageId);
    if (!triggerMessage) {
      log.warn(`Trigger message ${triggerMessageId} not found in database`);
      return null;
    }

    // Get all context messages between these two users
    const contextMessages = this.db.messages.getContextBetweenUsers(
      guildId,
      authorId,
      targetUserId,
      sinceTimestamp,
      100
    );

    if (contextMessages.length === 0) {
      log.debug('No context messages found between users');
      return null;
    }

    // Convert to ContextEntry format
    const entries = contextMessages.map((msg) => this.toContextEntry(msg));
    const triggerEntry = this.storedMessageToContextEntry(triggerMessage);

    // Calculate time span
    const timestamps = entries.map((e) => e.timestamp);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps, triggerEntry.timestamp);
    const timeSpanMinutes = Math.round((maxTime - minTime) / (60 * 1000));

    // Get unique involved users
    const involvedUsers = [...new Set([
      ...entries.map((e) => e.authorId),
      ...entries.flatMap((e) => e.mentionedUsers),
    ])];

    return {
      triggerMessage: triggerEntry,
      contextMessages: entries,
      involvedUsers,
      timeSpanMinutes,
    };
  }

  /**
   * Format context chain for LLM analysis
   */
  formatContextForAnalysis(context: ContextChain): string {
    const lines: string[] = [];

    lines.push('=== Cross-Channel Context ===');
    lines.push(`Time span: ${String(context.timeSpanMinutes)} minutes`);
    lines.push(`Users involved: ${String(context.involvedUsers.length)}`);
    lines.push('');
    lines.push('--- Conversation History ---');

    // Format each message chronologically
    for (const msg of context.contextMessages) {
      const time = new Date(msg.timestamp).toISOString();
      const channel = msg.channelName ?? msg.channelId;
      const author = msg.authorName ?? msg.authorId;
      const replyIndicator = msg.isReply ? ' (reply)' : '';
      const mentionIndicator = msg.mentionedUsers.length > 0
        ? ` [@${msg.mentionedUsers.join(', @')}]`
        : '';

      lines.push(`[${time}] #${channel} | ${author}${replyIndicator}${mentionIndicator}:`);
      lines.push(`  ${msg.content}`);
      lines.push('');
    }

    lines.push('--- Message Being Analyzed ---');
    const trigger = context.triggerMessage;
    const triggerTime = new Date(trigger.timestamp).toISOString();
    const triggerChannel = trigger.channelName ?? trigger.channelId;
    const triggerAuthor = trigger.authorName ?? trigger.authorId;

    lines.push(`[${triggerTime}] #${triggerChannel} | ${triggerAuthor}:`);
    lines.push(`  ${trigger.content}`);

    return lines.join('\n');
  }

  /**
   * Set channel name for better context display
   */
  setChannelName(channelId: string, name: string): void {
    this.channelNames.set(channelId, name);
  }

  /**
   * Set user name for better context display
   */
  setUserName(userId: string, name: string): void {
    this.userNames.set(userId, name);
  }

  private toContextEntry(msg: ContextMessage): ContextEntry {
    return {
      messageId: msg.id,
      channelId: msg.channel_id,
      channelName: this.channelNames.get(msg.channel_id),
      authorId: msg.author_id,
      authorName: this.userNames.get(msg.author_id),
      content: msg.content,
      timestamp: msg.timestamp,
      isReply: msg.reply_to_id !== null,
      isMention: msg.mentions.length > 0,
      mentionedUsers: msg.mentions,
    };
  }

  private storedMessageToContextEntry(msg: StoredMessage): ContextEntry {
    const mentions = JSON.parse(msg.mentions) as string[];
    return {
      messageId: msg.id,
      channelId: msg.channel_id,
      channelName: this.channelNames.get(msg.channel_id),
      authorId: msg.author_id,
      authorName: this.userNames.get(msg.author_id),
      content: msg.content,
      timestamp: msg.timestamp,
      isReply: msg.reply_to_id !== null,
      isMention: mentions.length > 0,
      mentionedUsers: mentions,
    };
  }
}
