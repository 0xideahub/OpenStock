import { NextResponse } from 'next/server';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

interface WatchlistSpotlightRequest {
  headline: string;
  summary?: string;
  ticker?: string;
  investorProfile?: {
    experience: 'beginner' | 'expert';
    style: 'growth' | 'value';
  };
}

interface WatchlistSpotlightResponse {
  hook: string;
  summary: string;
  detail: string;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
}

const FEATURE_SPOTLIGHT_SCHEMA = {
  type: 'object',
  required: ['hook', 'teaser', 'detail', 'sentiment'],
  properties: {
    hook: {
      type: 'string',
      maxLength: 40,
      description: 'Short 1-3 word title in title case',
    },
    teaser: {
      type: 'string',
      maxLength: 140,
      description: 'One sentence preview highlighting the story hook',
    },
    detail: {
      type: 'string',
      maxLength: 280,
      description: 'Two sentence deeper summary with context',
    },
    sentiment: {
      type: 'string',
      enum: ['Bullish', 'Bearish', 'Neutral'],
    },
  },
  additionalProperties: false,
} as const;

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  schema: typeof FEATURE_SPOTLIGHT_SCHEMA,
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
      temperature: 0.5,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'feature_spotlight',
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
    const body: WatchlistSpotlightRequest = await request.json();

    if (!body.headline) {
      return NextResponse.json({ error: 'Missing required field: headline' }, { status: 400 });
    }

    const experience = body.investorProfile?.experience ?? 'beginner';
    const style = body.investorProfile?.style ?? 'growth';

    // Build prompts
    const systemPrompt = [
      'You are Vaulk72, an AI research curator building teaser cards for watchlist news.',
      'Craft a punchy hook, a sharp teaser sentence, and a concise detail paragraph.',
      'Use the provided sentiment labels to classify the tone for investors.',
      'Return JSON matching the provided schema.',
      'Keep language crisp, energetic, and investment-focused.',
    ].join('\n');

    const contextSummary = body.summary?.trim() ?? '';
    const userPrompt = [
      `Headline: ${body.headline}`,
      contextSummary ? `Summary: ${contextSummary}` : '',
      body.investorProfile
        ? `Investor profile → Experience: ${experience}, Style: ${style}`
        : '',
      '',
      'Instructions:',
      '1. Hook: Use 1-3 words in Title Case that captures the story.',
      '2. Teaser: One sentence (~20 words) with the key action or catalyst.',
      '3. Detail: Two short sentences adding context or implications.',
      '4. Sentiment: Bullish, Bearish, or Neutral—be decisive.',
      'Avoid emojis or marketing fluff.',
    ]
      .filter(Boolean)
      .join('\n');

    // Call OpenAI
    const response = await callOpenAI(systemPrompt, userPrompt, FEATURE_SPOTLIGHT_SCHEMA);

    // Parse and validate response
    let parsed: unknown;
    try {
      parsed = JSON.parse(response);
    } catch {
      throw new Error('Failed to parse OpenAI feature spotlight response');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('OpenAI spotlight response was empty');
    }

    const { hook, teaser, detail, sentiment } = parsed as {
      hook: string;
      teaser: string;
      detail: string;
      sentiment: 'Bullish' | 'Bearish' | 'Neutral';
    };

    if (!hook || !teaser || !detail || !sentiment) {
      throw new Error('OpenAI spotlight response missing fields');
    }

    const result: WatchlistSpotlightResponse = {
      hook: hook.trim(),
      summary: teaser.trim(),
      detail: detail.trim(),
      sentiment,
    };

    return NextResponse.json(result, {
      headers: getRateLimitHeaders(rateLimitResult),
    });
  } catch (error) {
    console.error('[watchlist-spotlight] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate watchlist spotlight',
      },
      { status: 500 },
    );
  }
}
