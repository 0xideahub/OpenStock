import { NextResponse } from 'next/server';

import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';
import { authenticate } from '@/lib/auth';
import { fetchFundamentalsWithFallback } from '@/lib/services/fundamentals';
import { getCached, setCached, getManyCached } from '@/lib/cache';

export const revalidate = 0;

interface BatchRequest {
  symbols: string[];
}

interface BatchResponse {
  data: Record<string, any>;
  errors?: Record<string, string>;
}

const MAX_SYMBOLS_PER_REQUEST = 50;
const CACHE_TTL_SECONDS = 30 * 60; // 30 minutes

/**
 * POST /api/fundamentals/batch
 *
 * Batch endpoint for fetching fundamentals for multiple symbols
 * - Accepts array of symbols
 * - Returns all results in single response
 * - Counts as 1 rate limit hit regardless of symbol count
 * - Implements Redis caching per symbol
 */
export async function POST(request: Request) {
  // Rate Limiting Check - counts as 1 request regardless of symbols
  const rateLimitResult = await checkRateLimit(request);

  if (!rateLimitResult.success) {
    console.warn('[api:batch] Rate limit exceeded');
    return NextResponse.json(
      {
        error: 'Rate limit exceeded. Please try again later.',
      },
      {
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  // Authentication (supports API key or JWT)
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    // Authentication failed, return the error response
    return authResult;
  }

  let body: BatchRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: 'Invalid JSON body',
      },
      {
        status: 400,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  const { symbols } = body;

  // Validate symbols array
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return NextResponse.json(
      {
        error: 'symbols must be a non-empty array',
      },
      {
        status: 400,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  if (symbols.length > MAX_SYMBOLS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Maximum ${MAX_SYMBOLS_PER_REQUEST} symbols per request`,
      },
      {
        status: 400,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  // Normalize symbols
  const normalizedSymbols = symbols
    .map((s) => (typeof s === 'string' ? s.trim().toUpperCase() : ''))
    .filter((s) => s.length > 0);

  if (normalizedSymbols.length === 0) {
    return NextResponse.json(
      {
        error: 'No valid symbols provided',
      },
      {
        status: 400,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  console.log(`[api:batch] Processing ${normalizedSymbols.length} symbols: ${normalizedSymbols.join(', ')}`);

  try {
    // Build cache keys for all symbols
    const cacheKeys = normalizedSymbols.map((symbol) => `fundamentals:${symbol}`);

    // Try to get all from cache first
    const cachedResults = await getManyCached<any>(cacheKeys);

    // Identify which symbols need to be fetched
    const symbolsToFetch: string[] = [];
    const cachedData: Record<string, any> = {};

    normalizedSymbols.forEach((symbol, index) => {
      const cached = cachedResults[index];
      if (cached) {
        console.log(`[api:batch] Cache HIT for ${symbol}`);
        cachedData[symbol] = cached;
      } else {
        console.log(`[api:batch] Cache MISS for ${symbol}`);
        symbolsToFetch.push(symbol);
      }
    });

    // Fetch uncached symbols in parallel
    const fetchResults = await Promise.allSettled(
      symbolsToFetch.map((symbol) => fetchFundamentalsWithFallback(symbol))
    );

    const data: Record<string, any> = { ...cachedData };
    const errors: Record<string, string> = {};

    // Process fetch results
    fetchResults.forEach((result, index) => {
      const symbol = symbolsToFetch[index];

      if (result.status === 'fulfilled') {
        const fundamentals = result.value;
        data[symbol] = fundamentals;

        // Cache successful result
        setCached(`fundamentals:${symbol}`, fundamentals, CACHE_TTL_SECONDS).catch((err) =>
          console.error(`[api:batch] Failed to cache ${symbol}:`, err)
        );

        console.log(`[api:batch] ✅ Fetched ${symbol} from ${fundamentals.source}`);
      } else {
        const error = result.reason;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors[symbol] = errorMessage;

        console.error(`[api:batch] ❌ Failed to fetch ${symbol}:`, errorMessage);
      }
    });

    const response: BatchResponse = {
      data,
      ...(Object.keys(errors).length > 0 && { errors }),
    };

    const successCount = Object.keys(data).length;
    const errorCount = Object.keys(errors).length;

    console.log(
      `[api:batch] Complete: ${successCount} success, ${errorCount} errors (${normalizedSymbols.length} total)`
    );

    return NextResponse.json(response, {
      status: 200,
      headers: getRateLimitHeaders(rateLimitResult),
    });
  } catch (error) {
    console.error('[api:batch] Unexpected error:', error);

    const message = error instanceof Error ? error.message : 'Failed to process batch request';

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }
}
