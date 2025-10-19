import { NextRequest, NextResponse } from 'next/server';
import { ratelimit } from '@/lib/ratelimit';

const TIINGO_API_KEY = process.env.TIINGO_API_KEY;
const TIINGO_BASE_URL = 'https://api.tiingo.com';

interface DividendPayment {
  date: string;
  amount: number;
  exDate?: string;
  payDate?: string;
}

interface DividendHistoryResponse {
  symbol: string;
  data: DividendPayment[];
  fetchedAt: string;
}

/**
 * GET /api/dividend-history/[symbol]
 *
 * Fetches historical dividend payments for a given stock symbol
 * Returns last 2 years of dividend payments
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ symbol: string }> },
): Promise<NextResponse> {
  const { symbol } = await context.params;

  if (!symbol || typeof symbol !== 'string') {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
  }

  // API Key Authentication
  const apiKey = request.headers.get('x-api-key');
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.error('[api] INTERNAL_API_KEY not configured');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  if (apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  // Calculate start date (2 years ago)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - 2);
  const startDateStr = startDate.toISOString().split('T')[0];

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

    if (!Array.isArray(rawData)) {
      return NextResponse.json({ error: 'Invalid response format' }, { status: 500 });
    }

    // Extract dividend payments (entries with divCash field)
    const dividends: DividendPayment[] = rawData
      .filter((entry: any) => entry.divCash && entry.divCash > 0)
      .map((entry: any) => ({
        date: entry.date,
        amount: entry.divCash,
        exDate: entry.date, // Ex-dividend date
      }))
      .reverse(); // Most recent first

    const result: DividendHistoryResponse = {
      symbol: symbol.toUpperCase(),
      data: dividends,
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
    console.error(`[dividend-history] Error fetching history for ${symbol}:`, error);

    if (error.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timeout' }, { status: 504 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch dividend history' },
      { status: 500 },
    );
  }
}
