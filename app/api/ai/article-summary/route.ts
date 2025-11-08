import { NextResponse } from 'next/server';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

interface ArticleSummaryRequest {
  title: string;
  content: string;
  url: string;
  investorProfile?: {
    experience: 'beginner' | 'expert';
    style: 'growth' | 'value';
  };
}

interface ArticleSummary {
  summary: string;
  keyTakeaways: string[];
  investmentImplications: string;
  relatedSymbols: string[];
}

const ARTICLE_SUMMARY_SCHEMA = {
  type: 'object',
  required: ['summary', 'keyTakeaways', 'investmentImplications', 'relatedSymbols'],
  properties: {
    summary: {
      type: 'string',
      description: 'A concise 2-3 paragraph summary of the article',
    },
    keyTakeaways: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'string',
        description: 'Key points from the article',
      },
    },
    investmentImplications: {
      type: 'string',
      description: 'What this means for investors',
    },
    relatedSymbols: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^[A-Z0-9\\.]{1,6}$',
      },
      description: 'Stock tickers mentioned or relevant to this article',
    },
  },
  additionalProperties: false,
} as const;

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  schema: typeof ARTICLE_SUMMARY_SCHEMA,
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
          name: 'article_summary',
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
    const body: ArticleSummaryRequest = await request.json();

    // Validate request
    if (!body.title || !body.content || !body.url) {
      return NextResponse.json(
        { error: 'Missing required fields: title, content, url' },
        { status: 400 },
      );
    }

    const experience = body.investorProfile?.experience || 'beginner';
    const style = body.investorProfile?.style || 'growth';

    // Build prompts
    const systemPrompt = [
      'You are Vaulk72, an investment research assistant that summarizes financial news articles.',
      'Provide clear, actionable summaries tailored to the investor profile.',
      '',
      'Guidelines:',
      '1. Summary: Write 2-3 concise paragraphs capturing the main story, key facts, and context.',
      '2. Key Takeaways: Extract 3-5 specific, concrete points (facts, numbers, quotes).',
      '3. Investment Implications: Explain what this means for investors in 2-3 sentences.',
      '4. Related Symbols: Identify stock tickers mentioned or affected by this news.',
      '',
      'Personalization:',
      `- Investor Experience: ${experience}`,
      experience === 'beginner'
        ? '  → Use clear language, explain jargon, focus on broader market context'
        : '  → Use precise terminology, include specific metrics, focus on actionable insights',
      `- Investor Style: ${style}`,
      style === 'growth'
        ? '  → Highlight revenue growth, innovation, market expansion, competitive advantages'
        : '  → Highlight valuations, fundamentals, cash flow, dividend implications',
      '',
      'Be factual and objective. Do not speculate or add information not in the article.',
    ].join('\n');

    const userPrompt = [
      `Article Title: ${body.title}`,
      `Source URL: ${body.url}`,
      '',
      'Article Content:',
      body.content,
      '',
      'Provide a structured summary following the schema.',
    ].join('\n');

    // Call OpenAI
    const responseContent = await callOpenAI(systemPrompt, userPrompt, ARTICLE_SUMMARY_SCHEMA);

    // Parse and validate response
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseContent);
    } catch {
      throw new Error('Failed to parse OpenAI response as JSON');
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { summary?: unknown }).summary !== 'string' ||
      !Array.isArray((parsed as { keyTakeaways?: unknown }).keyTakeaways) ||
      typeof (parsed as { investmentImplications?: unknown }).investmentImplications !== 'string' ||
      !Array.isArray((parsed as { relatedSymbols?: unknown }).relatedSymbols)
    ) {
      throw new Error('OpenAI response missing required fields');
    }

    const result = parsed as ArticleSummary;

    // Clean up response
    const cleanedResult: ArticleSummary = {
      summary: result.summary.trim(),
      keyTakeaways: result.keyTakeaways.map((t) => t.trim()).filter(Boolean),
      investmentImplications: result.investmentImplications.trim(),
      relatedSymbols: result.relatedSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean),
    };

    return NextResponse.json(cleanedResult, {
      headers: getRateLimitHeaders(rateLimitResult),
    });
  } catch (error) {
    console.error('[article-summary] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate article summary',
      },
      { status: 500 },
    );
  }
}
