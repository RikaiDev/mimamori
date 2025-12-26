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

// Obvious negative keywords (keep for backward compatibility)
const OBVIOUS_NEGATIVE_KEYWORDS = [
  // English
  'stupid', 'idiot', 'incompetent', 'useless', 'pathetic', 'terrible',
  'worst', 'hate', 'disgusting', 'annoying', 'lazy', 'dumb', 'fool',
  // Japanese
  'バカ', 'アホ', '無能', '使えない', '最悪', 'ダメ', 'クソ',
  // Chinese
  '笨', '蠢', '廢物', '無能', '白痴', '垃圾', '爛',
];

// Subtle patterns - labeling behavior as personality traits
const LABELING_PATTERNS = [
  // Chinese - turning work issues into character flaws
  /壞習慣/,
  /態度(有)?問題/,
  /(他|她|你)(就是|一直都是)這樣/,
  /老是(這樣|如此)/,
  /每次都/,
  // English
  /bad habit/i,
  /attitude problem/i,
  /(he|she|they|you)'s? always like (this|that)/i,
  /every single time/i,
  // Japanese
  /悪い癖/,
  /態度が悪い/,
];

// Escalation language - signals potential harsh treatment
const ESCALATION_PATTERNS = [
  // Chinese
  /更?強硬/,
  /嚴正(聲明|警告)/,
  /下次再(這樣|如此)/,
  /不(能|可以)再/,
  /最後(一次)?警告/,
  // English
  /more (firm|strict|harsh)/i,
  /formal warning/i,
  /last (chance|warning)/i,
  /next time.*(will|gonna)/i,
  // Japanese
  /厳しく/,
  /最後の警告/,
];

// Generalizing patterns - implicit bias about groups
const GENERALIZING_PATTERNS = [
  // Chinese
  /你們.{0,4}(就是|都是|總是)這樣/,
  /.{1,4}果然/,
  /難怪(你|他|她)是/,
  // Age-related
  /老(人|害|古板)/,
  /年輕人(就是|都是)/,
  // Gender-related
  /女(人|生)(就是|都是|不行)/,
  /男(人|生)(就是|都是)/,
  // English
  /you (people|guys|all) (are|always)/i,
  /typical (of )?(you|them)/i,
  /no wonder (you|they)/i,
  /(women|men|girls|guys) (are|always|never|can't)/i,
  /old (people|folks|timer)/i,
  /young (people|kids) (are|always)/i,
  // Nationality/ethnicity
  /(外國人|外籍)(就是|都是)/,
];

// Leading/judgmental questions
const JUDGMENTAL_PATTERNS = [
  // Chinese
  /你(想|打算)怎麼帶.*team/i,
  /(他|她|他們)知道.*嗎\s*[？?]/,
  /你(有沒有|是不是)(想過|考慮過)/,
  // English
  /how do you (plan|intend) to/i,
  /do(es)? (he|she|they) (even )?(know|understand)/i,
  /have you (even )?(thought|considered)/i,
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
   * Now detects subtle patterns in addition to obvious ones
   */
  checkTrigger(
    content: string,
    authorId: string,
    mentions: string[],
    replyToAuthorId: string | null
  ): AnalysisTrigger {
    // Rule 1: Must mention or reply to someone (for targeted analysis)
    // BUT we also check for subtle patterns that don't require a target
    const targetUserId = replyToAuthorId ?? mentions[0];

    // Don't analyze self-mentions
    if (targetUserId && targetUserId === authorId) {
      return { shouldAnalyze: false, reason: 'Self-mention' };
    }

    const contentLower = content.toLowerCase();

    // Check for OBVIOUS negative keywords
    const hasObviousNegative = OBVIOUS_NEGATIVE_KEYWORDS.some((keyword) =>
      contentLower.includes(keyword.toLowerCase())
    );

    if (hasObviousNegative && targetUserId) {
      return {
        shouldAnalyze: true,
        reason: 'Obvious negative keyword detected',
        targetUserId,
      };
    }

    // Check for SUBTLE patterns (these are what we really want to catch)

    // Labeling patterns - turning work issues into personality
    const hasLabelingPattern = LABELING_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasLabelingPattern) {
      return {
        shouldAnalyze: true,
        reason: 'Labeling pattern detected (turning behavior into personality trait)',
        targetUserId: targetUserId ?? authorId, // Analyze even without target
      };
    }

    // Escalation patterns - signals harsh treatment incoming
    const hasEscalationPattern = ESCALATION_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasEscalationPattern) {
      return {
        shouldAnalyze: true,
        reason: 'Escalation language detected',
        targetUserId: targetUserId ?? authorId,
      };
    }

    // Generalizing patterns - implicit bias
    const hasGeneralizingPattern = GENERALIZING_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasGeneralizingPattern) {
      return {
        shouldAnalyze: true,
        reason: 'Generalizing/implicit bias pattern detected',
        targetUserId: targetUserId ?? authorId,
      };
    }

    // Judgmental questions - disguised criticism
    const hasJudgmentalPattern = JUDGMENTAL_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasJudgmentalPattern && targetUserId) {
      return {
        shouldAnalyze: true,
        reason: 'Judgmental/leading question detected',
        targetUserId,
      };
    }

    // Aggressive tone (exclamation marks, all caps)
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
