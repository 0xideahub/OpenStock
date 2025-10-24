import { createHash } from 'crypto';

import { getCached, setCached } from '../cache';
import { FetchTimeoutError, fetchWithTimeout } from '../utils/fetchWithTimeout';

type InvestorType = 'growth' | 'value' | 'income';
type Recommendation = 'buy' | 'hold' | 'pass';

export interface ComparisonSummaryPayload {
  stocks: Array<{
    ticker: string;
    name: string;
    recommendation: Recommendation;
    score: number;
    metrics?: Record<string, number | null | undefined>;
  }>;
  investorType: InvestorType;
  analysis: {
    overallWinner: string | null;
    strengths: Record<string, string[]>;
    weaknesses: Record<string, string[]>;
  };
}

interface ComparisonSummaryResult {
  summary: string;
  model?: string;
  cached: boolean;
  generatedAt: string;
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const CACHE_KEY_PREFIX = 'comparison-summary:';

const buildSystemPrompt = (): string =>
  `You are Vaulk72's equity comparison analyst. Produce a crisp, two-sentence summary (max 65 words) highlighting who leads, why it matters for the specified investor type, and any notable risks. Use natural language—no bullet points, headings, or markdown. Stay grounded in the provided data.`;

const buildUserPrompt = (payload: ComparisonSummaryPayload): string => {
  const lines: string[] = [];

  lines.push(`Investor type: ${payload.investorType.toUpperCase()}`);
  lines.push('Stocks JSON:');
  lines.push(JSON.stringify(payload.stocks, null, 2));
  lines.push('Analysis JSON:');
  lines.push(JSON.stringify(payload.analysis, null, 2));
  lines.push('Respond with a single paragraph (two sentences).');

  return lines.join('\n');
};

const sanitizeSummary = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const createCacheKey = (payload: ComparisonSummaryPayload): string => {
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `${CACHE_KEY_PREFIX}${hash}`;
};

export async function generateComparisonSummary(
  payload: ComparisonSummaryPayload,
): Promise<ComparisonSummaryResult> {
  if (!payload.stocks || payload.stocks.length === 0) {
    throw new Error('At least one stock is required to generate a comparison summary.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const cacheKey = createCacheKey(payload);
  const cached = await getCached<ComparisonSummaryResult>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(payload);

  try {
    const response = await fetchWithTimeout(
      OPENAI_API_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEFAULT_OPENAI_MODEL,
          temperature: 0.35,
          max_tokens: 160,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      },
      REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => response.statusText);
      throw new Error(
        `[comparison-summary] OpenAI request failed: ${response.status} ${response.statusText} - ${errorBody}`,
      );
    }

    const data = await response.json();

    const summary: string | undefined =
      data?.choices?.[0]?.message?.content &&
      typeof data.choices[0].message.content === 'string'
        ? sanitizeSummary(data.choices[0].message.content)
        : undefined;

    if (!summary) {
      throw new Error('[comparison-summary] OpenAI response missing summary content');
    }

    const result: ComparisonSummaryResult = {
      summary,
      model: data.model,
      cached: false,
      generatedAt: new Date().toISOString(),
    };

    await setCached(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  } catch (error) {
    if (error instanceof FetchTimeoutError) {
      console.warn('[comparison-summary] OpenAI request timed out:', error.message);
    } else {
      console.error('[comparison-summary] Failed to generate summary:', error);
    }
    throw error;
  }
}

