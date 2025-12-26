/**
 * Analyzer module exports
 */

export type {
  AnalysisResult,
  AnalysisRequest,
  AIProvider,
  AIProviderConfig,
  AIAnalyzer,
} from './types.js';

export { ClaudeAnalyzer } from './claude.js';
export { GeminiAnalyzer } from './gemini.js';
export { buildAnalysisPrompt, parseAnalysisResponse } from './prompts.js';

import type { AIAnalyzer, AIProvider } from './types.js';
import { ClaudeAnalyzer } from './claude.js';
import { GeminiAnalyzer } from './gemini.js';

/**
 * Factory function to create an AI analyzer based on provider
 */
export function createAnalyzer(
  provider: AIProvider,
  apiKey: string,
  model?: string
): AIAnalyzer {
  switch (provider) {
    case 'claude':
      return new ClaudeAnalyzer(apiKey, model);
    case 'gemini':
      return new GeminiAnalyzer(apiKey, model);
    default:
      throw new Error(`Unknown AI provider: ${String(provider)}`);
  }
}
