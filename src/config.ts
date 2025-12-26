/**
 * Configuration management for Mimamori
 */

import { config as dotenvConfig } from 'dotenv';

// Load .env file in development
dotenvConfig();

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for environment variable: ${key}`);
  }
  return parsed;
}

export type Language = 'en' | 'ja' | 'zh-TW';
export type SensitivityLevel = 'low' | 'medium' | 'high';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Config {
  // Discord
  discordToken: string;

  // Anthropic
  anthropicApiKey: string;

  // Language
  language: Language;

  // Analysis settings
  contextWindowHours: number;
  messageRetentionHours: number;
  notificationCooldownMinutes: number;
  sensitivityLevel: SensitivityLevel;

  // Logging
  logLevel: LogLevel;

  // Excluded channels
  excludedChannels: string[];
}

function parseExcludedChannels(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((id) => id.trim()).filter(Boolean);
}

function parseLanguage(value: string): Language {
  const valid: Language[] = ['en', 'ja', 'zh-TW'];
  if (valid.includes(value as Language)) {
    return value as Language;
  }
  console.warn(`Invalid language "${value}", defaulting to "en"`);
  return 'en';
}

function parseSensitivityLevel(value: string): SensitivityLevel {
  const valid: SensitivityLevel[] = ['low', 'medium', 'high'];
  if (valid.includes(value as SensitivityLevel)) {
    return value as SensitivityLevel;
  }
  console.warn(`Invalid sensitivity level "${value}", defaulting to "medium"`);
  return 'medium';
}

function parseLogLevel(value: string): LogLevel {
  const valid: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  if (valid.includes(value as LogLevel)) {
    return value as LogLevel;
  }
  console.warn(`Invalid log level "${value}", defaulting to "info"`);
  return 'info';
}

export function loadConfig(): Config {
  return {
    discordToken: getEnvVar('DISCORD_TOKEN'),
    anthropicApiKey: getEnvVar('ANTHROPIC_API_KEY'),
    language: parseLanguage(getEnvVar('LANGUAGE', 'en')),
    contextWindowHours: getEnvNumber('CONTEXT_WINDOW_HOURS', 2),
    messageRetentionHours: getEnvNumber('MESSAGE_RETENTION_HOURS', 24),
    notificationCooldownMinutes: getEnvNumber('NOTIFICATION_COOLDOWN_MINUTES', 30),
    sensitivityLevel: parseSensitivityLevel(getEnvVar('SENSITIVITY_LEVEL', 'medium')),
    logLevel: parseLogLevel(getEnvVar('LOG_LEVEL', 'info')),
    // eslint-disable-next-line @typescript-eslint/dot-notation
    excludedChannels: parseExcludedChannels(process.env['EXCLUDED_CHANNELS']),
  };
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  configInstance ??= loadConfig();
  return configInstance;
}
