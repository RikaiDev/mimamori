/**
 * Internationalization (i18n) module
 * Provides translations for all user-facing text
 */

import type { Language } from '../config.js';
import enTranslations from './en.json' with { type: 'json' };
import jaTranslations from './ja.json' with { type: 'json' };
import zhTWTranslations from './zh-TW.json' with { type: 'json' };

export interface NotificationTranslations {
  greeting: string;
  noticed: string;
  explanation: {
    discrimination: string;
    harassment: string;
    bullying: string;
    inappropriate: string;
    default: string;
  };
  suggestionIntro: string;
  closing: string;
}

export interface AnalysisTranslations {
  languageName: string;
}

export interface Translations {
  notification: NotificationTranslations;
  analysis: AnalysisTranslations;
}

const translations: Record<Language, Translations> = {
  en: enTranslations as Translations,
  ja: jaTranslations as Translations,
  'zh-TW': zhTWTranslations as Translations,
};

/**
 * Get all translations for a language
 */
export function getTranslations(language: Language): Translations {
  return translations[language];
}

/**
 * Get notification translations for a language
 */
export function getNotificationTranslations(language: Language): NotificationTranslations {
  return translations[language].notification;
}

/**
 * Get the display name of a language
 */
export function getLanguageName(language: Language): string {
  return translations[language].analysis.languageName;
}

/**
 * Build a notification message from translations
 */
export function buildNotificationMessage(
  language: Language,
  channelName: string,
  issueType: string,
  suggestion?: string
): string {
  const t = getNotificationTranslations(language);
  const parts: string[] = [];

  parts.push(t.greeting);
  parts.push('');
  parts.push(t.noticed.replace('{channelName}', channelName));
  parts.push('');

  // Get explanation based on issue type
  const explanationMap: Record<string, string> = t.explanation;
  const explanation = explanationMap[issueType] ?? t.explanation.default;
  parts.push(explanation);

  if (suggestion) {
    parts.push('');
    parts.push(t.suggestionIntro);
    parts.push(`> ${suggestion}`);
  }

  parts.push('');
  parts.push(t.closing);

  return parts.join('\n');
}
