import { NextResponse } from 'next/server';

import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';
import { generateAnalysis } from '@/lib/ai/generateAnalysis';
import { evaluateStock } from '@/lib/valuation/evaluateStock';
import { authenticate } from '@/lib/auth';

type InvestorType = 'growth' | 'value' | 'income';

interface AnalysisRequestBody {
  investorType: InvestorType;
  companyName?: string;
  // recommendation, reasons, warnings are now optional - will be calculated if not provided
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

  // Authentication (supports API key or JWT)
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    // Authentication failed, return the error response
    return authResult;
  }
  // authResult is AuthResult with userId and method

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

  try {
    // Calculate valuation if not provided (unified flow)
    // Support both legacy flow (recommendation provided) and new unified flow (calculate here)
    let recommendation = payload.recommendation;
    let reasons = payload.reasons ?? [];
    let warnings = payload.warnings ?? [];
    let score: number | undefined;

    if (!recommendation && investorType !== 'income') {
      // New unified flow: Calculate valuation server-side
      console.log(`[analysis] Received metrics for ${normalizedSymbol}:`, JSON.stringify(payload.metrics, null, 2));
      const valuation = evaluateStock(payload.metrics ?? {}, investorType);
      recommendation = valuation.recommendation;
      reasons = valuation.reasons;
      warnings = valuation.warnings;
      score = valuation.score;
      console.log(`[analysis] Calculated valuation for ${normalizedSymbol}: ${recommendation} (score: ${score})`);
    } else if (!recommendation) {
      // Income investor type not yet supported for server-side evaluation
      return NextResponse.json(
        { error: 'recommendation must be provided for income investor type' },
        {
          status: 400,
          headers: getRateLimitHeaders(rateLimitResult),
        },
      );
    }

    if (!['buy', 'hold', 'pass'].includes(recommendation)) {
      return NextResponse.json(
        { error: 'recommendation must be one of "buy", "hold", or "pass"' },
        {
          status: 400,
          headers: getRateLimitHeaders(rateLimitResult),
        },
      );
    }

    const result = await generateAnalysis({
      symbol: normalizedSymbol,
      investorType,
      companyName: payload.companyName,
      recommendation,
      metrics: payload.metrics ?? {},
      reasons,
      warnings,
    });

    // Return unified response with valuation data + AI analysis
    return NextResponse.json(
      {
        data: {
          ...result,
          recommendation, // Include recommendation in response
          score, // Include score if calculated (undefined for legacy flow)
          reasons, // Include reasons
          warnings, // Include warnings
        },
      },
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
