import { NextResponse } from 'next/server';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

interface PersonalPulseInsight {
  symbol: string;
  reason: string;
}

interface PersonalPulseResponse {
  pulse: string;
  insights: PersonalPulseInsight[];
}

interface PersonalPulsePayload {
  user: {
    name?: string;
    investorExperience: 'beginner' | 'expert';
    investorStyle: 'growth' | 'value';
    lastVisit: string;
  };
  watchlistSymbols: string[];
  marketDeltas: {
    symbol: string;
    priceChangePctSinceLastVisit: number;
    recommendation?: 'buy' | 'hold' | 'pass';
  }[];
  fallbackSymbolPool: string[];
}

const PERSONAL_PULSE_SCHEMA = {
  type: 'object',
  required: ['pulse', 'insights'],
  properties: {
    pulse: {
      type: 'string',
      maxLength: 90,
    },
    insights: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        required: ['symbol', 'reason'],
        properties: {
          symbol: {
            type: 'string',
            pattern: '^[A-Z0-9\\.]{1,6}$',
          },
          reason: {
            type: 'string',
            maxLength: 60,
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  schema: typeof PERSONAL_PULSE_SCHEMA,
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
      temperature: 0.4,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'personal_pulse',
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
    const body: { payload: PersonalPulsePayload } = await request.json();

    if (!body.payload) {
      return NextResponse.json({ error: 'Missing payload' }, { status: 400 });
    }

    const { payload } = body;

    // Build prompts
    const systemPrompt = [
      'You are Vaulk72, an investment research assistant. Respond ONLY with compact JSON that satisfies the provided schema.',
      'Never include Markdown, commentary, or extra keys.',
      '',
      'Guidelines:',
      '1. Pulse is one sentence (<=90 characters) summarizing material changes since the user\'s last visit.',
      'Mention tangible shifts (price moves, leadership vs. market) when data exists. If the watchlist is empty, output exactly "No saved stocks yet".',
      '2. Provide exactly three insights. Each insight reason must be plain English (<=60 characters) with no marketing fluff, emojis, or lists.',
      '3. CRITICAL - Symbol Selection:',
      '   • If watchlistSymbols has 3+ stocks: Use ONLY the first 3 stocks from watchlistSymbols. NEVER use fallbackSymbolPool.',
      '   • If watchlistSymbols has fewer than 3 stocks: Fill remaining slots from fallbackSymbolPool.',
      '   • If watchlistSymbols is empty: Use ONLY fallbackSymbolPool symbols.',
      '4. CRITICAL - Recommendation Alignment:',
      '   • Each stock has a "recommendation" field: "buy", "hold", or "pass"',
      '   • For "buy" recommendations: Emphasize positive aspects, opportunities, strong fundamentals',
      '   • For "hold" recommendations: Acknowledge mixed signals, "watch and wait" tone, neutral language',
      '   • For "pass" recommendations: Highlight concerns, caution flags, valuation issues - NEVER suggest buying',
      '   • Your insight MUST align with our analysis. If we say "pass", your reason should reflect caution.',
      '5. Personalization rules:',
      '   • investorStyle: "growth" → highlight positive momentum, revenue/EPS acceleration, innovation themes.',
      '     "value" → highlight discounts vs. peers, resilient fundamentals, improving margins.',
      '   • investorExperience: "beginner" → friendly tone using simple descriptors (e.g., "Steady gains this week").',
      '     "expert" → include specific stats when available (e.g., "EPS +12% YoY; P/S 15% below sector median").',
      '6. Use marketDeltas whenever possible to reference real movements ("+2.8% since you checked in").',
      'If data is missing, stay general but grounded in style heuristics—never fabricate numbers.',
      '7. Avoid repeating identical reasoning phrases. Keep verbs action-oriented.',
    ].join('\n');

    const userPrompt = [
      'Given this context:',
      JSON.stringify(payload, null, 2),
      '',
      'Return JSON matching the schema. Respect all length limits and personalization rules.',
      'Do not invent tickers outside the supplied lists.',
    ].join('\n');

    // Call OpenAI
    const content = await callOpenAI(systemPrompt, userPrompt, PERSONAL_PULSE_SCHEMA);

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
      typeof (parsed as { pulse?: unknown }).pulse !== 'string' ||
      !Array.isArray((parsed as { insights?: unknown }).insights)
    ) {
      throw new Error('OpenAI response missing pulse or insights');
    }

    const { pulse, insights } = parsed as PersonalPulseResponse;

    const normalizedInsights = insights
      .filter(
        (item) =>
          Boolean(item) &&
          typeof item.symbol === 'string' &&
          typeof item.reason === 'string',
      )
      .map((item) => ({
        symbol: item.symbol.trim().toUpperCase(),
        reason: item.reason.trim(),
      }))
      .slice(0, 3);

    if (!pulse || normalizedInsights.length !== 3) {
      throw new Error('OpenAI returned invalid personal pulse content');
    }

    const result: PersonalPulseResponse = {
      pulse: pulse.trim(),
      insights: normalizedInsights,
    };

    return NextResponse.json(result, {
      headers: getRateLimitHeaders(rateLimitResult),
    });
  } catch (error) {
    console.error('[personal-pulse] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate personal pulse',
      },
      { status: 500 },
    );
  }
}
