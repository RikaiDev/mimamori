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

// ============================================================
// NEW PATTERNS based on real-world cases from Dcard, PTT, and
// labor dispute legal documents (勞動判決)
// ============================================================

// Direct personal attacks - 直接人身攻擊
const INSULT_PATTERNS = [
  // Chinese insults
  /笨蛋/, /白癡/, /廢物/, /累贅/, /低能/, /智障/,
  /腦(袋|子)有問題/, /聽不懂人話/, /人話都聽不懂/,
  /沒用/, /沒腦袋/, /腦袋裝什麼/,
  /你是不是有病/, /有毛病/,
  // English insults
  /idiot/i, /moron/i, /useless/i, /brain ?dead/i,
  /what('s| is) wrong with you/i,
  // Japanese insults
  /馬鹿/, /アホ/, /役立たず/, /使えない奴/,
];

// Competence denial - 能力否定
const COMPETENCE_DENIAL_PATTERNS = [
  // Chinese
  /你(到底|根本)?(怎麼|哪裡)(會|能)/,
  /連這(都|也)(不會|做不到|搞不懂)/,
  /這(種|麼)(簡單|基本)(的事|的東西)?都(不會|做不好)/,
  /你(的)?能力(不行|不夠|不足|有問題)/,
  /這是基本(常識|的東西)/,
  /你(到底|究竟)怎麼(想的|做事)/,
  /你(是不是|到底)(學不會|聽不懂)/,
  /現在解釋有什麼用/,
  /誰讓你不(事先|先)(確認|檢查)/,
  // English
  /how (did|could) you (even )?get this job/i,
  /can't (even )?do (simple|basic)/i,
  /what were you thinking/i,
  /this is basic/i,
  // Japanese
  /こんな(簡単|基本的)なこと(も|さえ)/,
];

// Threats and intimidation - 威脅恐嚇
const THREAT_PATTERNS = [
  // Chinese
  /準備(走人|離職|滾蛋|收東西)/,
  /別想(升職|加薪|升遷)/,
  /再(這樣|出錯|犯錯).{0,6}(就|我就|你就)/,
  /向(主管|老闆|HR|人資)報告/,
  /你(最好|給我)(不要|別)再/,
  /這(件事|次)搞砸.{0,4}你就/,
  /看你(還能|能)待多久/,
  /走著瞧/,
  /你(完蛋|死定)了/,
  // English
  /you('re| are) (fired|done|finished)/i,
  /start (looking|packing)/i,
  /forget about (promotion|raise)/i,
  /i('ll| will) report (this|you)/i,
  /you('d| had) better (not|watch)/i,
  // Japanese
  /クビ(にする|だ)/, /辞めろ/, /覚えておけ/,
];

// Gender discrimination - 性別歧視
const GENDER_BIAS_PATTERNS = [
  // Chinese
  /女(生|人|性)(就是|不適合|做不來|不懂)/,
  /男(生|人|性)才(能|會|適合|懂)/,
  /懷孕(還|就)(來|敢|要)/,
  /什麼時候(結婚|生小孩|生孩子)/,
  /(結婚|生小孩|生孩子)(了嗎|沒)/,
  /女子無才便是德/,
  /女生(就是)?愛(耍|玩)心機/,
  /女生就是(麻煩|囉嗦|情緒化)/,
  /男生(比較|就是比)(適合|懂|厲害)/,
  /這是(男生|女生)的(工作|事)/,
  // English
  /women (are|can't|don't|shouldn't)/i,
  /men are (better|more|just)/i,
  /she('s| is) (too )?emotional/i,
  /typical (woman|girl|female)/i,
  /man up/i,
  /boys will be boys/i,
  // Japanese
  /女(だから|のくせに)/, /男(なら|だから)/,
];

// Age discrimination - 年齡歧視
const AGE_BIAS_PATTERNS = [
  // Chinese - against older workers
  /年紀大(了)?就/, /老(了|人家)(就|跟不上|學不會)/,
  /老(人|員工)(就是|都是|不行)/,
  /(該|應該)(退休|讓位|讓年輕人)了/,
  /老古板/, /老頑固/, /倚老賣老/,
  // Chinese - against younger workers
  /年輕人(就是|太|都是)(不懂事|嫩|草莓)/,
  /小孩子(懂|知道)什麼/,
  /草莓族/, /玻璃心/,
  /吃不了苦/, /抗壓(性|力)(差|不夠|低)/,
  /現在(的)?年輕人/,
  // English
  /too old (to|for)/i,
  /old (timer|dog|school)/i,
  /(kids|millennials|gen ?z) (these days|are|don't)/i,
  /back in my day/i,
  /young(er)? (people|generation) (are|don't|can't)/i,
  // Japanese
  /年寄り(は|だから)/, /若い(奴|者)(は|なんて)/,
];

// Condescending/patronizing - 說教貶低
const CONDESCENDING_PATTERNS = [
  // Chinese
  /你(應該|要)(多)?(檢討|反省)(自己)?/,
  /聽我的(準沒錯|就對了|沒錯)/,
  /我是為(你|妳)好/,
  /(吃苦|辛苦)(是|當)(應該的|吃補|福氣)/,
  /年輕(人|的時候)就(是|該|要)(多)?吃(點)?苦/,
  /別(想|說)那麼多/,
  /你(這樣|那樣)(怎麼|哪能)(行|可以)/,
  /我(都是|這樣)(過來的|熬過來的)/,
  /不要(老是|一直|總是)抱怨/,
  // English
  /you should (really )?reflect/i,
  /i('m| am) (just )?trying to help/i,
  /trust me (on this|i know)/i,
  /when i was your age/i,
  /stop complaining/i,
  /that's (just )?how it (is|works)/i,
  // Japanese
  /俺(の言う通り|が正しい)/, /文句(を|ばかり)言う/,
];

// Dismissive/minimizing - 冷漠忽視
const DISMISSIVE_PATTERNS = [
  // Chinese
  /別(大驚小怪|小題大作)/,
  /沒什麼大不了/,
  /這(有什麼|算什麼)(好|值得)/,
  /想太多了?/,
  /日子(還不是|不還是)(得|要)過/,
  /抗壓性(太差|不夠)/,
  /這(點|麼點)(小事|事情)/,
  /玻璃心/,
  // English
  /don't (be so )?dramatic/i,
  /you('re| are) over ?react/i,
  /it's not (a )?big deal/i,
  /just (deal|live) with it/i,
  /stop being (so )?(sensitive|dramatic)/i,
  // Japanese
  /大げさ/, /気にしすぎ/,
];

// Humiliation in front of others - 公開羞辱
const PUBLIC_HUMILIATION_PATTERNS = [
  // Chinese
  /(大家|各位|你們)(看看|評評理)/,
  /讓(大家|他們)(看看|知道)/,
  /這(種|樣的)(人|員工|表現)/,
  /(我|咱們|我們)來(看看|說說)/,
  // English
  /everyone(,)? (look|see)/i,
  /let me (show|tell) everyone/i,
  /this is (what|how) (you|they)/i,
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

    // ============================================================
    // NEW PATTERN CHECKS based on real-world cases
    // ============================================================

    // Direct insults - 直接人身攻擊
    const hasInsultPattern = INSULT_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasInsultPattern) {
      return {
        shouldAnalyze: true,
        reason: 'Direct personal insult detected (人身攻擊)',
        targetUserId: targetUserId ?? authorId,
      };
    }

    // Competence denial - 能力否定
    const hasCompetenceDenial = COMPETENCE_DENIAL_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasCompetenceDenial && targetUserId) {
      return {
        shouldAnalyze: true,
        reason: 'Competence denial detected (能力否定)',
        targetUserId,
      };
    }

    // Threats - 威脅恐嚇
    const hasThreatPattern = THREAT_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasThreatPattern) {
      return {
        shouldAnalyze: true,
        reason: 'Threat/intimidation detected (威脅恐嚇)',
        targetUserId: targetUserId ?? authorId,
      };
    }

    // Gender bias - 性別歧視
    const hasGenderBias = GENDER_BIAS_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasGenderBias) {
      return {
        shouldAnalyze: true,
        reason: 'Gender discrimination detected (性別歧視)',
        targetUserId: targetUserId ?? authorId,
      };
    }

    // Age bias - 年齡歧視
    const hasAgeBias = AGE_BIAS_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasAgeBias) {
      return {
        shouldAnalyze: true,
        reason: 'Age discrimination detected (年齡歧視)',
        targetUserId: targetUserId ?? authorId,
      };
    }

    // Condescending - 說教貶低
    const hasCondescending = CONDESCENDING_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasCondescending && targetUserId) {
      return {
        shouldAnalyze: true,
        reason: 'Condescending/patronizing language detected (說教貶低)',
        targetUserId,
      };
    }

    // Dismissive - 冷漠忽視
    const hasDismissive = DISMISSIVE_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasDismissive && targetUserId) {
      return {
        shouldAnalyze: true,
        reason: 'Dismissive/minimizing language detected (冷漠忽視)',
        targetUserId,
      };
    }

    // Public humiliation - 公開羞辱
    const hasPublicHumiliation = PUBLIC_HUMILIATION_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (hasPublicHumiliation && targetUserId) {
      return {
        shouldAnalyze: true,
        reason: 'Public humiliation pattern detected (公開羞辱)',
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
