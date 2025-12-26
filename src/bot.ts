/**
 * Discord bot setup and message handling
 */

import {
  Client,
  GatewayIntentBits,
  Message,
  Partials,
  Events,
} from 'discord.js';
import { getConfig } from './config.js';
import { log } from './logger.js';
import { DatabaseManager, initializeDatabase, formatSignalForContext } from './database/index.js';
import { ContextTracker, SignalAggregator } from './context/index.js';
import { createAnalyzer, type AIAnalyzer, type AnalysisResult } from './analyzer/index.js';
import { Notifier } from './actions/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MimamoriBot {
  private client: Client;
  private db: DatabaseManager | null = null;
  private contextTracker: ContextTracker | null = null;
  private signalAggregator: SignalAggregator | null = null;
  private analyzer: AIAnalyzer | null = null;
  private notifier: Notifier | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private isReady = false;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel], // Required for DM support
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, (readyClient) => {
      this.isReady = true;
      log.info(`Bot is ready! Logged in as ${readyClient.user.tag}`);
      log.info(`Watching ${String(readyClient.guilds.cache.size)} guild(s)`);
    });

    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessage(message);
    });

    this.client.on(Events.Error, (error) => {
      log.error('Discord client error:', error);
    });

    this.client.on(Events.Warn, (warning) => {
      log.warn('Discord client warning:', warning);
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Ignore DMs for now (we only monitor guild channels)
    if (!message.guild) return;

    const config = getConfig();

    // Check if channel is excluded
    if (config.excludedChannels.includes(message.channel.id)) {
      return;
    }

    log.debug(
      `[${message.guild.name}] #${this.getChannelName(message)} | ${message.author.tag}: ${message.content.substring(0, 100)}${message.content.length > 100 ? '...' : ''}`
    );

    // Store message in database
    const mentions = this.storeMessage(message);

    // Update context tracker with channel/user names
    this.updateContextNames(message);

    // Check if analysis should be triggered
    await this.checkAndAnalyze(message, mentions);
  }

  private storeMessage(message: Message): string[] {
    if (!this.db || !message.guild) return [];

    // Extract mentions
    const mentions = message.mentions.users.map((user) => user.id);

    // Get reply info if this is a reply
    const replyToId = message.reference?.messageId ?? null;
    // We can't easily get the reply author without fetching, so we'll leave it null for now
    // The context tracker can look it up if needed
    const replyToAuthorId: string | null = null;

    this.db.messages.insert({
      id: message.id,
      guild_id: message.guild.id,
      channel_id: message.channel.id,
      author_id: message.author.id,
      content: message.content,
      timestamp: message.createdTimestamp,
      reply_to_id: replyToId,
      reply_to_author_id: replyToAuthorId,
      mentions: JSON.stringify(mentions),
    });

    // Record interactions for mentions and replies
    if (mentions.length > 0 || replyToId) {
      this.recordInteractions(message, mentions);
    }

    return mentions;
  }

  private recordInteractions(message: Message, mentions: string[]): void {
    if (!this.db || !message.guild) return;

    const guildId = message.guild.id;
    const authorId = message.author.id;
    const timestamp = message.createdTimestamp;

    // Record interaction for each mentioned user
    for (const mentionedUserId of mentions) {
      if (mentionedUserId !== authorId) {
        this.db.interactions.recordInteraction(
          guildId,
          authorId,
          mentionedUserId,
          timestamp,
          [message.channel.id]
        );
      }
    }
  }

  private updateContextNames(message: Message): void {
    if (!this.contextTracker) return;

    // Store channel name
    const channelName = this.getChannelName(message);
    this.contextTracker.setChannelName(message.channel.id, channelName);

    // Store author name
    this.contextTracker.setUserName(message.author.id, message.author.tag);

    // Store mentioned user names
    for (const [userId, user] of message.mentions.users) {
      this.contextTracker.setUserName(userId, user.tag);
    }
  }

  private async checkAndAnalyze(message: Message, mentions: string[]): Promise<void> {
    if (!this.contextTracker || !this.analyzer || !message.guild) return;

    const config = getConfig();

    // Get reply author if this is a reply
    let replyToAuthorId: string | null = null;
    if (message.reference?.messageId && this.db) {
      const replyToMsg = this.db.messages.getById(message.reference.messageId);
      if (replyToMsg) {
        replyToAuthorId = replyToMsg.author_id;
      }
    }

    // Check if we should analyze this message
    const trigger = this.contextTracker.checkTrigger(
      message.content,
      message.author.id,
      mentions,
      replyToAuthorId
    );

    if (!trigger.shouldAnalyze || !trigger.targetUserId) {
      return;
    }

    log.info(`Analysis triggered: ${trigger.reason}`);
    log.debug(`Author: ${message.author.tag}, Target: ${trigger.targetUserId}`);

    // Build cross-channel context
    const context = this.contextTracker.buildContext(
      message.guild.id,
      message.id,
      message.author.id,
      trigger.targetUserId
    );

    if (!context) {
      log.debug('No context available for analysis');
      return;
    }

    // Format context for analysis
    const formattedContext = this.contextTracker.formatContextForAnalysis(context);
    log.debug(`Context built with ${String(context.contextMessages.length)} messages spanning ${String(context.timeSpanMinutes)} minutes`);

    // Get target user name
    const targetUser = message.mentions.users.get(trigger.targetUserId);
    const targetName = targetUser?.tag ?? trigger.targetUserId;

    // Get long-term signal context if available
    let signalContext: string | undefined;
    if (this.signalAggregator) {
      const signal = this.signalAggregator.getSignalContext(
        message.guild.id,
        message.author.id,
        trigger.targetUserId
      );
      if (signal && signal.concerning_count >= 2) {
        signalContext = formatSignalForContext(signal, message.author.tag, targetName);
        log.info(`Long-term signal found: ${String(signal.concerning_count)} concerning interactions`);
      }
    }

    // Analyze with AI
    log.info(`Sending to ${this.analyzer.name} for analysis...`);
    const result = await this.analyzer.analyze({
      context: formattedContext,
      messageContent: message.content,
      authorName: message.author.tag,
      targetName,
      language: config.language,
      signalContext,
    });

    // Log the result
    this.logAnalysisResult(result);

    // Record result in signal aggregator for long-term tracking
    if (this.signalAggregator && trigger.targetUserId) {
      const aggregationResult = this.signalAggregator.recordAnalysis(
        message.guild.id,
        message.author.id,
        trigger.targetUserId,
        result
      );

      if (aggregationResult.isNewConcern) {
        log.warn(`⚠️ New concerning pattern threshold reached: ${message.author.tag} → ${targetName}`);
      }
      if (aggregationResult.trendChanged) {
        log.warn(`📈 Pattern worsening: ${message.author.tag} → ${targetName}`);
      }
    }

    // Send notification if concerning
    if (result.isConcerning && this.notifier) {
      log.warn(`Concerning message detected! Severity: ${result.severity}, Type: ${result.issueType}`);
      log.info(`Reason: ${result.reason}`);

      const channelName = this.getChannelName(message);
      const notificationResult = await this.notifier.notify({
        guildId: message.guild.id,
        channelId: message.channel.id,
        channelName,
        messageId: message.id,
        authorId: message.author.id,
        authorName: message.author.tag,
        targetName,
        messageContent: message.content,
        analysisResult: result,
      });

      if (notificationResult.success) {
        log.info('Notification sent successfully');
      } else if (notificationResult.skipped) {
        log.debug(`Notification skipped: ${notificationResult.skipReason ?? 'unknown'}`);
      } else {
        log.warn(`Notification failed: ${notificationResult.reason ?? 'unknown'}`);
      }
    }
  }

  private logAnalysisResult(result: AnalysisResult): void {
    if (result.isConcerning) {
      log.warn('Analysis result: CONCERNING');
      log.warn(`  Severity: ${result.severity}`);
      log.warn(`  Type: ${result.issueType}`);
      log.warn(`  Confidence: ${String(result.confidence)}`);
      log.warn(`  Reason: ${result.reason}`);
    } else {
      log.debug('Analysis result: OK');
      log.debug(`  Confidence: ${String(result.confidence)}`);
      log.debug(`  Reason: ${result.reason}`);
    }
  }

  private getChannelName(message: Message): string {
    if ('name' in message.channel && message.channel.name) {
      return message.channel.name;
    }
    return message.channel.id;
  }

  private startCleanupJob(): void {
    const config = getConfig();
    const cleanupIntervalMs = 60 * 60 * 1000; // Run every hour

    log.info(`Starting cleanup job (retention: ${String(config.messageRetentionHours)} hours)`);

    // Run immediately once
    this.db?.cleanupOldMessages(config.messageRetentionHours);

    // Then run periodically
    this.cleanupInterval = setInterval(() => {
      this.db?.cleanupOldMessages(config.messageRetentionHours);
    }, cleanupIntervalMs);
  }

  private stopCleanupJob(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  async start(): Promise<void> {
    const config = getConfig();
    log.info('Starting Mimamori bot...');

    // Initialize database
    const dbPath = path.join(__dirname, '..', 'data', 'mimamori.db');
    const dbDir = path.dirname(dbPath);

    // Ensure data directory exists
    const fs = await import('fs');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = initializeDatabase(dbPath);
    this.db = new DatabaseManager(db);

    // Initialize context tracker
    this.contextTracker = new ContextTracker(this.db);

    // Initialize signal aggregator for long-term pattern tracking
    this.signalAggregator = new SignalAggregator(db);
    log.info('Signal aggregator initialized for long-term pattern tracking');

    // Initialize AI analyzer
    const apiKey = config.aiProvider === 'claude'
      ? config.anthropicApiKey
      : config.geminiApiKey;

    if (!apiKey) {
      throw new Error(`API key not configured for provider: ${config.aiProvider}`);
    }

    this.analyzer = createAnalyzer(config.aiProvider, apiKey, config.aiModel);
    log.info(`AI analyzer initialized: ${config.aiProvider}`);

    // Initialize notifier
    this.notifier = new Notifier(
      this.client,
      this.db,
      config.notificationCooldownMinutes,
      config.language
    );
    log.info('Notifier initialized');

    // Start cleanup job
    this.startCleanupJob();

    try {
      await this.client.login(config.discordToken);
    } catch (error) {
      log.error('Failed to login to Discord:', error);
      this.db.close();
      throw error;
    }
  }

  async stop(): Promise<void> {
    log.info('Stopping Mimamori bot...');

    // Stop cleanup job
    this.stopCleanupJob();

    // Close database
    this.db?.close();
    this.db = null;
    this.contextTracker = null;
    this.signalAggregator = null;
    this.analyzer = null;
    this.notifier = null;

    await this.client.destroy();
    this.isReady = false;
  }

  getClient(): Client {
    return this.client;
  }

  getDatabase(): DatabaseManager | null {
    return this.db;
  }

  getContextTracker(): ContextTracker | null {
    return this.contextTracker;
  }

  getAnalyzer(): AIAnalyzer | null {
    return this.analyzer;
  }

  getNotifier(): Notifier | null {
    return this.notifier;
  }

  getSignalAggregator(): SignalAggregator | null {
    return this.signalAggregator;
  }

  getIsReady(): boolean {
    return this.isReady;
  }
}
