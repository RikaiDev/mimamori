/**
 * Claude AI provider for message analysis
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AIAnalyzer, AnalysisRequest, AnalysisResult } from './types.js';
import { buildAnalysisPrompt, parseAnalysisResponse } from './prompts.js';
import { log } from '../logger.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export class ClaudeAnalyzer implements AIAnalyzer {
  readonly name = 'claude' as const;
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? DEFAULT_MODEL;
    log.info(`Claude analyzer initialized with model: ${this.model}`);
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const prompt = buildAnalysisPrompt(request);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Extract text from response
      const textContent = response.content.find((block) => block.type === 'text');
      if (textContent?.type !== 'text') {
        log.error('Claude returned no text content');
        return this.getDefaultResult();
      }

      const parsed = parseAnalysisResponse(textContent.text);
      if (!parsed) {
        log.error('Failed to parse Claude response:', textContent.text);
        return this.getDefaultResult();
      }

      return parsed;
    } catch (error) {
      log.error('Claude API error:', error);
      return this.getDefaultResult();
    }
  }

  private getDefaultResult(): AnalysisResult {
    return {
      isConcerning: false,
      severity: 'low',
      issueType: 'none',
      reason: 'Analysis failed, defaulting to non-concerning',
      suggestion: '',
      confidence: 0,
    };
  }
}
