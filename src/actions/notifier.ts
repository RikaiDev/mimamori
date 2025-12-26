/**
 * Private DM notification system
 * Sends friendly reminders to users when concerning behavior is detected
 */

import type { Client, User } from 'discord.js';
import type { DatabaseManager } from '../database/index.js';
import type { Language } from '../config.js';
import type { NotificationContext, NotificationResult } from './types.js';
import { buildNotificationMessage } from './templates.js';
import { log } from '../logger.js';

export class Notifier {
  private client: Client;
  private db: DatabaseManager;
  private cooldownMinutes: number;
  private language: Language;

  constructor(
    client: Client,
    db: DatabaseManager,
    cooldownMinutes: number,
    language: Language
  ) {
    this.client = client;
    this.db = db;
    this.cooldownMinutes = cooldownMinutes;
    this.language = language;
  }

  /**
   * Send a notification to a user about their concerning message
   */
  async notify(context: NotificationContext): Promise<NotificationResult> {
    const { analysisResult } = context;

    // Skip if not concerning
    if (!analysisResult.isConcerning) {
      return {
        success: false,
        skipped: true,
        skipReason: 'not_concerning',
      };
    }

    // Check for duplicate (already alerted for this message)
    const existingAlert = this.db.alerts.getByMessage(context.messageId);
    if (existingAlert) {
      log.debug(`Skipping notification: already alerted for message ${context.messageId}`);
      return {
        success: false,
        skipped: true,
        skipReason: 'duplicate',
      };
    }

    // Check cooldown (user was alerted recently)
    const cooldownTimestamp = Date.now() - this.cooldownMinutes * 60 * 1000;
    if (this.db.alerts.hasRecentAlert(context.authorId, cooldownTimestamp)) {
      log.debug(`Skipping notification: user ${context.authorId} is in cooldown period`);
      return {
        success: false,
        skipped: true,
        skipReason: 'cooldown',
      };
    }

    // Build the notification message
    const message = buildNotificationMessage(
      this.language,
      context.channelName,
      analysisResult.issueType,
      analysisResult.suggestion
    );

    // Send the DM
    try {
      const user = await this.fetchUser(context.authorId);
      if (!user) {
        log.warn(`Could not find user ${context.authorId} to send DM`);
        return {
          success: false,
          reason: 'User not found',
        };
      }

      await this.sendDM(user, message);

      // Record the alert
      this.db.alerts.insert({
        message_id: context.messageId,
        guild_id: context.guildId,
        channel_id: context.channelId,
        author_id: context.authorId,
        severity: analysisResult.severity,
        reason: analysisResult.reason,
      });

      log.info(`Sent DM notification to user ${user.tag} for message ${context.messageId}`);
      return { success: true };
    } catch (error) {
      return this.handleDMError(error, context.authorId);
    }
  }

  /**
   * Fetch a user from Discord
   */
  private async fetchUser(userId: string): Promise<User | null> {
    try {
      return await this.client.users.fetch(userId);
    } catch {
      return null;
    }
  }

  /**
   * Send a DM to a user
   */
  private async sendDM(user: User, message: string): Promise<void> {
    const dmChannel = await user.createDM();
    await dmChannel.send(message);
  }

  /**
   * Handle DM errors gracefully
   */
  private handleDMError(error: unknown, authorId: string): NotificationResult {
    // Check if user has DMs disabled
    if (this.isDMDisabledError(error)) {
      log.info(`User ${authorId} has DMs disabled, skipping notification`);
      return {
        success: false,
        skipped: true,
        skipReason: 'dm_disabled',
      };
    }

    // Log other errors
    log.error(`Failed to send DM to user ${authorId}:`, error);
    return {
      success: false,
      reason: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  /**
   * Check if the error is due to user having DMs disabled
   */
  private isDMDisabledError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    // Discord API error codes for DM restrictions
    // 50007: Cannot send messages to this user
    const message = error.message.toLowerCase();
    return (
      message.includes('cannot send messages to this user') ||
      message.includes('50007')
    );
  }
}
