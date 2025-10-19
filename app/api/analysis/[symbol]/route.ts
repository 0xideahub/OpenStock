import { NextResponse } from 'next/server';

import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';
import { generateAnalysis } from '@/lib/ai/generateAnalysis';

type InvestorType = 'growth' | 'value' | 'income';

interface AnalysisRequestBody {
  investorType: InvestorType;
  companyName?: string;
  recommendation?: 'buy' | 'hold' | 'pass';
  metrics?: {
    pe?: number;
    pb?: number;
    roe?: number;
    roeActual?: number | null;
    growth?: number;
    debtToEquity?: number;
    revenueCagr3Y?: number | null;
    earningsCagr3Y?: number | null;
    dividendYield?: number | null;
    payoutRatio?: number | null;
    freeCashflowPayoutRatio?: number | null;
    currentRatio?: number | null;
    quickRatio?: number | null;
  };
  reasons?: string[];
  warnings?: string[];
}

const SUPPORTED_INVESTOR_TYPES: InvestorType[] = ['growth', 'value', 'income'];

export async function POST(
  request: Request,
  context: { params: Promise<{ symbol?: string }> },
) {
  const rateLimitResult = await checkRateLimit(request);

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      {
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  }

  const apiKey = request.headers.get('x-api-key');
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.error('[analysis] INTERNAL_API_KEY not configured');
    return NextResponse.json(
      { error: 'Server configuration error' },
      {
        status: 500,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  }

  if (!apiKey || apiKey !== expectedKey) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      {
        status: 401,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  }

  const { symbol } = await context.params;
  const normalizedSymbol = symbol?.trim().toUpperCase();
  if (!normalizedSymbol) {
    return NextResponse.json(
      { error: 'Ticker symbol is required' },
      {
        status: 400,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  }

  let payload: AnalysisRequestBody;
  try {
    payload = (await request.json()) as AnalysisRequestBody;
  } catch (_error) {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      {
        status: 400,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  }

  const investorType = payload?.investorType;

  if (!investorType) {
    return NextResponse.json(
      { error: 'investorType is required' },
      {
        status: 400,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  }

  if (!SUPPORTED_INVESTOR_TYPES.includes(investorType)) {
    return NextResponse.json(
      { error: `Analysis for investor type "${investorType}" is not available yet.` },
      {
        status: 501,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  }

  if (!payload.recommendation || !['buy', 'hold', 'pass'].includes(payload.recommendation)) {
    return NextResponse.json(
      { error: 'recommendation must be one of "buy", "hold", or "pass"' },
      {
        status: 400,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  }

  try {
    const result = await generateAnalysis({
      symbol: normalizedSymbol,
      investorType,
      companyName: payload.companyName,
      recommendation: payload.recommendation,
      metrics: payload.metrics ?? {},
      reasons: payload.reasons ?? [],
      warnings: payload.warnings ?? [],
    });

    return NextResponse.json(
      { data: result },
      {
        status: 200,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  } catch (error) {
    console.error('[analysis] Failed to generate analysis:', error);
    return NextResponse.json(
      { error: 'Failed to generate analysis' },
      {
        status: 500,
        headers: getRateLimitHeaders(rateLimitResult),
      },
    );
  }
}
