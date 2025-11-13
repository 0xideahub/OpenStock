import { NextRequest, NextResponse } from 'next/server';

import { generateComparisonSummary } from '@/lib/ai/generateComparisonSummary';
import { authenticate } from '@/lib/auth';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';

type InvestorType = 'growth' | 'value' | 'income';
type Recommendation = 'buy' | 'hold' | 'pass';

interface ComparisonStockPayload {
  ticker: string;
  name: string;
  recommendation: Recommendation;
  score: number;
  metrics?: Record<string, number | null | undefined>;
}

interface ComparisonSummaryRequestBody {
  stocks?: ComparisonStockPayload[];
  investorType?: InvestorType;
  analysis?: {
    overallWinner?: string | null;
    strengths?: Record<string, string[]>;
    weaknesses?: Record<string, string[]>;
  };
}

const SUPPORTED_INVESTOR_TYPES: InvestorType[] = ['growth', 'value', 'income'];

const extractInternalApiKey = (req: NextRequest): string | null => {
  const apiKeyHeader = req.headers.get('x-api-key');
  if (apiKeyHeader) {
    const value = apiKeyHeader.trim();
    return value.length > 0 ? value : null;
  }

  return null;
};

const validateRequestBody = (body: ComparisonSummaryRequestBody) => {
  if (!body.stocks || !Array.isArray(body.stocks) || body.stocks.length === 0) {
    throw new Error('stocks array is required and must contain at least one entry');
  }

  if (!body.investorType || !SUPPORTED_INVESTOR_TYPES.includes(body.investorType)) {
    throw new Error('investorType must be one of growth, value, or income');
  }

  body.stocks.forEach((stock, index) => {
    if (!stock?.ticker || typeof stock.ticker !== 'string') {
      throw new Error(`stocks[${index}].ticker is required`);
    }
    if (!stock?.name || typeof stock.name !== 'string') {
      throw new Error(`stocks[${index}].name is required`);
    }
    if (!['buy', 'hold', 'pass'].includes(stock.recommendation)) {
      throw new Error(`stocks[${index}].recommendation must be buy, hold, or pass`);
    }
    if (typeof stock.score !== 'number' || Number.isNaN(stock.score)) {
      throw new Error(`stocks[${index}].score must be a number`);
    }
  });
};

export async function POST(req: NextRequest) {
  const rateLimitResult = await checkRateLimit(req);

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) },
    );
  }

  let userId: string | null = null;

  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.replace('Bearer ', '').trim()
    : null;

  if (bearerToken) {
    const authResult = await authenticate(req);
    if (!(authResult instanceof NextResponse)) {
      userId = authResult.userId;
    }
  }

  if (!userId) {
    let expectedKey: string | undefined;
    try {
      expectedKey = process.env.INTERNAL_API_KEY;
      if (!expectedKey) {
        throw new Error('INTERNAL_API_KEY not configured');
      }
    } catch (error) {
      console.error('[comparison-summary] Missing configuration:', error);
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500, headers: getRateLimitHeaders(rateLimitResult) },
      );
    }

    const providedKey = extractInternalApiKey(req);

    if (!providedKey || providedKey !== expectedKey) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: getRateLimitHeaders(rateLimitResult) },
      );
    }
  }

  let body: ComparisonSummaryRequestBody;
  try {
    body = (await req.json()) as ComparisonSummaryRequestBody;
  } catch (_error) {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: getRateLimitHeaders(rateLimitResult) },
    );
  }

  try {
    validateRequestBody(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid request payload' },
      { status: 400, headers: getRateLimitHeaders(rateLimitResult) },
    );
  }

  try {
    const result = await generateComparisonSummary({
      stocks: body.stocks!.map((stock) => ({
        ...stock,
        ticker: stock.ticker.toUpperCase(),
      })),
      investorType: body.investorType!,
      analysis: {
        overallWinner: body.analysis?.overallWinner ?? null,
        strengths: body.analysis?.strengths ?? {},
        weaknesses: body.analysis?.weaknesses ?? {},
      },
    });

    return NextResponse.json(
      {
        summary: result.summary,
        model: result.model,
        cached: result.cached,
        generatedAt: result.generatedAt,
      },
      { status: 200, headers: getRateLimitHeaders(rateLimitResult) },
    );
  } catch (error) {
    console.error('[comparison-summary] Failed to build summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate comparison summary' },
      { status: 502, headers: getRateLimitHeaders(rateLimitResult) },
    );
  }
}
