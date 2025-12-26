/**
 * Mimamori - Workplace Atmosphere Guardian
 *
 * A Discord bot that monitors workplace chat for potential discrimination
 * or harassment, providing gentle private reminders when issues are detected.
 */

import { MimamoriBot } from './bot.js';
import { log } from './logger.js';

async function main(): Promise<void> {
  log.info('Mimamori - Workplace Atmosphere Guardian');
  log.info('========================================');

  const bot = new MimamoriBot();

  // Handle graceful shutdown
  const shutdown = (): void => {
    log.info('Received shutdown signal...');
    void bot.stop().then(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await bot.start();
  } catch (error) {
    log.error('Failed to start bot:', error);
    process.exit(1);
  }
}

void main();
