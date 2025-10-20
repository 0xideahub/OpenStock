import { FetchTimeoutError, fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getCached, setCached } from '../cache';

interface WhatsChangedFacts {
  generatedAt: string;
  investorType: 'growth' | 'value' | 'income' | null;
  experienceLevel: 'beginner' | 'intermediate' | 'expert' | null;
  appVersion?: string;
  watchlist: {
    count: number;
    tickers: string[];
    recentlyAdded?: Array<{ ticker: string; name: string; addedAt: string }>;
    recentlyAnalyzed?: Array<{ ticker: string; name: string; analyzedAt: string }>;
    updatedAt: string;
  };
  lastValuation?: {
    ticker: string;
    companyName: string;
    recommendation: 'buy' | 'hold' | 'pass';
    savedAt: string;
  };
}

type WhatsChangedResult = {
  message: string;
  createdAt: string;
  model?: string;
};

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const CACHE_KEY_PREFIX = 'whats-changed:';
const FALLBACK_MESSAGES = [
  'Markets are steady but your watchlist could use a check-in—pick a saved stock to review.',
  'No major swings since your last visit. Re-run a valuation to stay ahead.',
  'Still quiet out there—scan your watchlist for the next move.',
];

const hashFacts = async (facts: WhatsChangedFacts): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(facts));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const buildSystemPrompt = (): string => `You are Vaulk72's re-engagement assistant.
Craft a single, high-energy sentence (max 18 words) that highlights what changed since the user's last session.
Lead with momentum and urgency, referencing their watchlist or investor profile when possible. No emojis.`;

const buildUserPrompt = (facts: WhatsChangedFacts): string => {
  const lines: string[] = [];

  lines.push('Facts JSON:');
  lines.push(JSON.stringify(facts, null, 2));
  lines.push('Respond with only the sentence.');
  lines.push('Example tones:');
  lines.push('- Markets are up 1.3% today — 2 of your watchlist stocks hit new highs.');
  lines.push('- AAPL climbed 4% since your last visit. Want to re-run the analysis?');
  lines.push('- Three fresh insights match your income strategy. Add one to the watchlist.');
  lines.push('Choose the strongest angle available from the facts.');

  return lines.join('\n');
};

const pickFallbackMessage = (): string => {
  const index = Math.floor(Math.random() * FALLBACK_MESSAGES.length);
  return FALLBACK_MESSAGES[index];
};

export async function generateWhatsChangedUpdate(
  facts: WhatsChangedFacts,
): Promise<WhatsChangedResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      message: pickFallbackMessage(),
      createdAt: new Date().toISOString(),
    };
  }

  const factsHash = await hashFacts(facts);
  const cacheKey = `${CACHE_KEY_PREFIX}${factsHash}`;

  const cached = await getCached<WhatsChangedResult>(cacheKey);
  if (cached) {
    return { ...cached, createdAt: cached.createdAt, model: cached.model };
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(facts);

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
          temperature: 0.2,
          max_tokens: 60,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      },
      REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `OpenAI request failed (${response.status} ${response.statusText}) ${errorText}`.trim(),
      );
    }

    const data = await response.json();
    const message =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.text?.trim() ||
      pickFallbackMessage();

    const result: WhatsChangedResult = {
      message,
      createdAt: new Date().toISOString(),
      model: data?.model,
    };

    await setCached(cacheKey, result, CACHE_TTL_SECONDS);

    return result;
  } catch (error) {
    const reason =
      error instanceof FetchTimeoutError
        ? 'OpenAI request timed out'
        : error instanceof Error
          ? error.message
          : 'Unknown OpenAI error';

    console.error('[whats-changed] Failed to call OpenAI:', reason);

    return {
      message: pickFallbackMessage(),
      createdAt: new Date().toISOString(),
    };
  }
}
