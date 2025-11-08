import { NextRequest, NextResponse } from 'next/server';
import { ratelimit } from '@/lib/ratelimit';
import { fetchYahooPriceHistory } from '@/lib/yahoo/priceHistory';
import { authenticate } from '@/lib/auth';

const TIINGO_API_KEY = process.env.TIINGO_API_KEY;
const TIINGO_BASE_URL = 'https://api.tiingo.com';

interface PriceHistoryEntry {
  date: string;
  close: number;
  volume?: number;
}

interface PriceHistoryResponse {
  symbol: string;
  data: PriceHistoryEntry[];
  period: string;
  fetchedAt: string;
}

/**
 * GET /api/price-history/[symbol]
 *
 * Fetches historical price data for a given stock symbol
 * Query params:
 *   - period: '6m' | '1y' | '3y' | '5y' (default: '6m')
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
): Promise<NextResponse> {
  const { symbol } = await context.params;

  if (!symbol || typeof symbol !== 'string') {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
  }

  // Authentication (supports API key or JWT)
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    // Authentication failed, return the error response
    return authResult;
  }
  // authResult is AuthResult with userId and method

  // Rate Limiting
  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';

  let rateLimitResult = {
    success: true,
    limit: 60,
    remaining: 60,
    reset: Date.now() + 60000,
  };

  if (ratelimit) {
    rateLimitResult = await ratelimit.limit(ip);

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': rateLimitResult.limit.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': rateLimitResult.reset.toString(),
          },
        },
      );
    }
  }

  // Get period from query params (default: 6 months)
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') ?? '6m';

  // Calculate start date based on period
  const endDate = new Date();
  const startDate = new Date();

  switch (period) {
    case '1y':
      startDate.setFullYear(endDate.getFullYear() - 1);
      break;
    case '3y':
      startDate.setFullYear(endDate.getFullYear() - 3);
      break;
    case '5y':
      startDate.setFullYear(endDate.getFullYear() - 5);
      break;
    case '6m':
    default:
      startDate.setMonth(endDate.getMonth() - 6);
      break;
  }

  const startDateStr = startDate.toISOString().split('T')[0];

  // Try Yahoo Finance first - free and unlimited
  try {
    const result = await fetchYahooPriceHistory(symbol, period);

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': rateLimitResult.reset.toString(),
      },
    });
  } catch (yahooError) {
    console.warn(`[price-history] Yahoo fetch failed for ${symbol}, falling back to Tiingo:`, yahooError);
  }

  // Fall back to Tiingo if Yahoo fails
  try {
    if (!TIINGO_API_KEY) {
      throw new Error('TIINGO_API_KEY is not configured');
    }

    const url = `${TIINGO_BASE_URL}/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${startDateStr}&token=${TIINGO_API_KEY}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
      }
      throw new Error(`Tiingo API error: ${response.status}`);
    }

    const rawData = await response.json();

    if (!Array.isArray(rawData) || rawData.length === 0) {
      return NextResponse.json({ error: 'No price history available' }, { status: 404 });
    }

    // Transform to simplified format
    const data: PriceHistoryEntry[] = rawData.map((entry: any) => ({
      date: entry.date,
      close: entry.close,
      volume: entry.volume,
    }));

    const result: PriceHistoryResponse = {
      symbol: symbol.toUpperCase(),
      data,
      period,
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': rateLimitResult.reset.toString(),
      },
    });
  } catch (error: any) {
    console.error(`[price-history] Error fetching history for ${symbol}:`, error);

    if (error.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timeout' }, { status: 504 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch price history' },
      { status: 500 },
    );
  }
}
