/**
 * Prompt templates for AI analysis
 */

import type { AnalysisRequest } from './types.js';

export function buildAnalysisPrompt(request: AnalysisRequest): string {
  return `You are Mimamori, a workplace atmosphere guardian. Your job is to analyze workplace Discord messages to identify potential discrimination, harassment, or bullying while avoiding false positives.

## Important Context
You are given a cross-channel conversation history. This is crucial because:
- A manager correcting an employee in a private channel AFTER seeing their mistake in a public channel is LEGITIMATE FEEDBACK, not harassment
- Context from other channels helps distinguish between constructive criticism and problematic behavior
- Always consider the full conversation flow before making a judgment

## Analysis Guidelines

### What IS problematic:
- Personal attacks unrelated to work
- Discriminatory language (age, gender, race, nationality)
- Repeated targeting of an individual
- Humiliation or public shaming
- Threats or intimidation
- Mocking someone's abilities or background

### What is NOT problematic:
- Constructive criticism about work performance
- Factual corrections of mistakes
- Direct feedback on work quality
- Professional disagreements
- Urgent requests for fixes (even if stern)
- Technical discussions that may sound harsh but are work-related

## Conversation Context
${request.context}

## Message to Analyze
Author: ${request.authorName}
${request.targetName ? `Target: ${request.targetName}` : ''}
Content: ${request.messageContent}

## Your Task
Analyze the message considering ALL the context provided. Determine if this is:
1. Legitimate workplace feedback/criticism (NOT concerning)
2. Potentially problematic behavior (IS concerning)

Respond in JSON format only:
{
  "isConcerning": boolean,
  "severity": "low" | "medium" | "high",
  "issueType": "discrimination" | "harassment" | "bullying" | "inappropriate" | "none",
  "reason": "Brief explanation of your analysis",
  "suggestion": "If concerning, suggest a friendly DM message in ${getLanguageName(request.language)}. If not concerning, leave empty.",
  "confidence": number between 0 and 1
}

Remember: When in doubt, consider the context. Workplace feedback, even if direct or stern, is usually legitimate if it's about work performance and follows from a visible work-related issue.`;
}

function getLanguageName(lang: 'en' | 'ja' | 'zh-TW'): string {
  switch (lang) {
    case 'en':
      return 'English';
    case 'ja':
      return 'Japanese';
    case 'zh-TW':
      return 'Traditional Chinese';
  }
}

interface AnalysisResponse {
  isConcerning: boolean;
  severity?: 'low' | 'medium' | 'high';
  issueType?: 'discrimination' | 'harassment' | 'bullying' | 'inappropriate' | 'none';
  reason?: string;
  suggestion?: string;
  confidence?: number;
}

export function parseAnalysisResponse(response: string): {
  isConcerning: boolean;
  severity: 'low' | 'medium' | 'high';
  issueType: 'discrimination' | 'harassment' | 'bullying' | 'inappropriate' | 'none';
  reason: string;
  suggestion: string;
  confidence: number;
} | null {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response;
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/;
    const codeBlockMatch = codeBlockRegex.exec(response);
    if (codeBlockMatch?.[1]) {
      jsonStr = codeBlockMatch[1];
    }

    // Try to find JSON object in the response
    const objectRegex = /\{[\s\S]*\}/;
    const objectMatch = objectRegex.exec(jsonStr);
    if (objectMatch) {
      jsonStr = objectMatch[0];
    }

    const parsed = JSON.parse(jsonStr) as AnalysisResponse;

    // Validate required fields
    if (typeof parsed.isConcerning !== 'boolean') {
      return null;
    }

    return {
      isConcerning: parsed.isConcerning,
      severity: parsed.severity ?? 'low',
      issueType: parsed.issueType ?? 'none',
      reason: parsed.reason ?? '',
      suggestion: parsed.suggestion ?? '',
      confidence: parsed.confidence ?? 0.5,
    };
  } catch {
    return null;
  }
}
