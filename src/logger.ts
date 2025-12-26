/**
 * Simple logging utility for Mimamori
 */

import { getConfig, type LogLevel } from './config.js';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getTimestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  try {
    const config = getConfig();
    return LOG_LEVELS[level] >= LOG_LEVELS[config.logLevel];
  } catch {
    // Config not loaded yet, default to info level
    return LOG_LEVELS[level] >= LOG_LEVELS.info;
  }
}

function formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
  const timestamp = getTimestamp();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (args.length === 0) {
    return `${prefix} ${message}`;
  }

  const formattedArgs = args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.stack ?? arg.message;
      }
      if (arg === null) {
        return 'null';
      }
      if (typeof arg === 'object') {
        return JSON.stringify(arg, null, 2);
      }
      if (typeof arg === 'string') {
        return arg;
      }
      if (typeof arg === 'number' || typeof arg === 'boolean') {
        return String(arg);
      }
      // For symbols, functions, undefined, etc.
      return typeof arg === 'undefined' ? 'undefined' : '[unknown]';
    })
    .join(' ');

  return `${prefix} ${message} ${formattedArgs}`;
}

export const log = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, ...args));
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, ...args));
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, ...args));
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, ...args));
    }
  },
};
