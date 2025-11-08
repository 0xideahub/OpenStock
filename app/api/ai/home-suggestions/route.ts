import { NextResponse } from 'next/server';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

interface HomeSuggestionsRequest {
  watchlistTickers?: string[];
  investorProfile?: string;
}

interface AiSuggestion {
  ticker: string;
  name: string;
  reason: string;
}

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        required: ['ticker', 'name', 'reason'],
        properties: {
          ticker: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          reason: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const;

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  schema: typeof SUGGESTION_SCHEMA,
): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY not configured on server');
  }

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'investment_suggestions',
          schema,
        },
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OpenAI] Error:', response.status, errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function POST(request: Request) {
  // Rate limiting
  const rateLimitResult = await checkRateLimit(request);

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      {
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  }

  try {
    const body: HomeSuggestionsRequest = await request.json();

    const watchlistTickers = body.watchlistTickers || [];
    const investorProfile = body.investorProfile || 'growth';

    // Build prompts
    const systemPrompt =
      'You are Vaulk72, an investment research assistant that recommends equities. Provide concise reasons aligned with the user interest in fewer than 18 words.';

    const userPrompt = `Generate ${Math.min(
      5,
      Math.max(3, watchlistTickers.length || 3),
    )} public company ideas for an investor with a ${investorProfile} profile. ${
      watchlistTickers.length > 0
        ? `Avoid repeating companies from this watchlist: ${watchlistTickers.join(', ')}.`
        : ''
    } Respond with fresh, timely sounding headlines.`;

    // Call OpenAI
    const content = await callOpenAI(systemPrompt, userPrompt, SUGGESTION_SCHEMA);

    // Parse and validate response
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Failed to parse OpenAI content as JSON');
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { suggestions?: unknown }).suggestions)
    ) {
      throw new Error('OpenAI response missing suggestions array');
    }

    const suggestions = (parsed as { suggestions: AiSuggestion[] }).suggestions
      .filter(
        (item) =>
          Boolean(item) &&
          typeof item.ticker === 'string' &&
          typeof item.name === 'string' &&
          typeof item.reason === 'string',
      )
      .map((item) => ({
        ticker: item.ticker.trim().toUpperCase(),
        name: item.name.trim(),
        reason: item.reason.trim(),
      }));

    if (suggestions.length === 0) {
      throw new Error('OpenAI returned an empty suggestions list');
    }

    return NextResponse.json(
      { suggestions },
      {
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  } catch (error) {
    console.error('[home-suggestions] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate home suggestions',
      },
      { status: 500 },
    );
  }
}
