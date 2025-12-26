/**
 * Gemini AI provider for message analysis
 */

import { GoogleGenAI } from '@google/genai';
import type { AIAnalyzer, AnalysisRequest, AnalysisResult } from './types.js';
import { buildAnalysisPrompt, parseAnalysisResponse } from './prompts.js';
import { log } from '../logger.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';

export class GeminiAnalyzer implements AIAnalyzer {
  readonly name = 'gemini' as const;
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model ?? DEFAULT_MODEL;
    log.info(`Gemini analyzer initialized with model: ${this.model}`);
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const prompt = buildAnalysisPrompt(request);

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: prompt,
      });

      const text = response.text;
      if (!text) {
        log.error('Gemini returned no text content');
        return this.getDefaultResult();
      }

      const parsed = parseAnalysisResponse(text);
      if (!parsed) {
        log.error('Failed to parse Gemini response:', text);
        return this.getDefaultResult();
      }

      return parsed;
    } catch (error) {
      log.error('Gemini API error:', error);
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
