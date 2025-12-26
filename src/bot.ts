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

export class MimamoriBot {
  private client: Client;
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

    // TODO: Store message in database (Issue #3)
    // TODO: Check if analysis should be triggered
    // TODO: Build context and analyze (Issue #4, #5)
    // TODO: Send notification if needed (Issue #6)
  }

  private getChannelName(message: Message): string {
    if ('name' in message.channel && message.channel.name) {
      return message.channel.name;
    }
    return message.channel.id;
  }

  async start(): Promise<void> {
    const config = getConfig();
    log.info('Starting Mimamori bot...');

    try {
      await this.client.login(config.discordToken);
    } catch (error) {
      log.error('Failed to login to Discord:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    log.info('Stopping Mimamori bot...');
    await this.client.destroy();
    this.isReady = false;
  }

  getClient(): Client {
    return this.client;
  }

  getIsReady(): boolean {
    return this.isReady;
  }
}
