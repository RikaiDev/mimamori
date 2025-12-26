/**
 * Type definitions for the analyzer module
 */

export interface AnalysisResult {
  /** Whether the message is concerning */
  isConcerning: boolean;
  /** Severity level if concerning */
  severity: 'low' | 'medium' | 'high';
  /** Type of issue detected */
  issueType: 'discrimination' | 'harassment' | 'bullying' | 'inappropriate' | 'none';
  /** Explanation of the analysis */
  reason: string;
  /** Suggested DM content for the user */
  suggestion: string;
  /** Confidence score (0-1) */
  confidence: number;
}

export interface AnalysisRequest {
  /** Formatted context from ContextTracker */
  context: string;
  /** The message content being analyzed */
  messageContent: string;
  /** Author's display name */
  authorName: string;
  /** Target user's display name (if any) */
  targetName?: string;
  /** Language preference for the response */
  language: 'en' | 'ja' | 'zh-TW';
}

export type AIProvider = 'claude' | 'gemini';

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
}

/**
 * Base interface for AI providers
 */
export interface AIAnalyzer {
  /** Provider name */
  readonly name: AIProvider;

  /**
   * Analyze a message with context
   */
  analyze(request: AnalysisRequest): Promise<AnalysisResult>;
}
