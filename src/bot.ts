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
import { DatabaseManager, initializeDatabase } from './database/index.js';
import { ContextTracker } from './context/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MimamoriBot {
  private client: Client;
  private db: DatabaseManager | null = null;
  private contextTracker: ContextTracker | null = null;
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
      this.handleMessage(message);
    });

    this.client.on(Events.Error, (error) => {
      log.error('Discord client error:', error);
    });

    this.client.on(Events.Warn, (warning) => {
      log.warn('Discord client warning:', warning);
    });
  }

  private handleMessage(message: Message): void {
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
    this.checkAndAnalyze(message, mentions);
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

  private checkAndAnalyze(message: Message, mentions: string[]): void {
    if (!this.contextTracker || !message.guild) return;

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

    // TODO: Send to Claude for analysis (Issue #5)
    // TODO: Send notification if concerning (Issue #6)

    // For now, just log the context
    log.debug('Formatted context:');
    log.debug(formattedContext);
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

  getIsReady(): boolean {
    return this.isReady;
  }
}
