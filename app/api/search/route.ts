import { NextRequest, NextResponse } from 'next/server';
import { getCached, setCached } from '@/lib/cache';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';
import { authenticate } from '@/lib/auth';

/**
 * Stock Search API
 *
 * Searches for stocks by company name or ticker symbol
 * Uses Yahoo Finance search API with Redis caching
 *
 * GET /api/search?q=apple
 */

interface YahooSearchQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchDisp?: string;
  sector?: string;
}

interface YahooSearchResponse {
  quotes: YahooSearchQuote[];
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  sector?: string;
}

export async function GET(req: NextRequest) {
  // Rate Limiting Check
  const rateLimitResult = await checkRateLimit(req);

  if (!rateLimitResult.success) {
    console.warn('[api/search] Rate limit exceeded');
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  // JWT Authentication
  const authResult = await authenticate(req);
  if (authResult instanceof NextResponse) {
    // Authentication failed, return the error response
    return authResult;
  }
  // authResult is AuthResult with userId and method

  const searchParams = req.nextUrl.searchParams;
  const query = searchParams.get('q');

  // Validate query
  if (!query || query.trim().length < 1) {
    return NextResponse.json(
      { error: 'Query parameter "q" is required and must be at least 1 character' },
      { status: 400, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  const normalizedQuery = query.trim().toLowerCase();

  // Check cache first (1 hour TTL)
  const cacheKey = `search:${normalizedQuery}`;
  try {
    const cached = await getCached<SearchResult[]>(cacheKey);
    if (cached) {
      if (Array.isArray(cached) && cached.length === 0) {
        console.log(`[search] Cache contained empty results for "${query}", refetching`);
      } else {
        console.log(`[search] Cache hit for query: "${query}"`);
        return NextResponse.json({
          results: cached,
          cached: true
        }, { headers: getRateLimitHeaders(rateLimitResult) });
      }
    }
  } catch (cacheError) {
    console.warn('[search] Cache read failed:', cacheError);
    // Continue without cache
  }

  // Fetch from Yahoo Finance
  try {
    const yahooUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}`;
    console.log(`[search] Fetching from Yahoo Finance: "${query}"`);

    const response = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; vaulk72/1.0)',
      },
    });

    if (!response.ok) {
      console.error(`[search] Yahoo Finance error: ${response.status} ${response.statusText}`);
      return NextResponse.json(
        { error: 'Search service unavailable', results: [] },
        { status: response.status, headers: getRateLimitHeaders(rateLimitResult) }
      );
    }

    const data: YahooSearchResponse = await response.json();

    // Filter and transform results
    // Only include US equities, exclude ETFs, mutual funds, etc.
    const results: SearchResult[] = data.quotes
      .filter((quote) => {
        // Only include equities (stocks)
        if (quote.quoteType !== 'EQUITY') return false;

        // Only include US exchanges (NASDAQ, NYSE, AMEX)
        const usExchanges = [
          'NASDAQ',
          'NYSE',
          'AMEX',
          'NMS', // Nasdaq Global Market
          'NGM', // Nasdaq Global Market (alias)
          'NGS', // Nasdaq Global Select Market
          'NYQ', // NYSE
          'NCM', // Nasdaq Capital Market
        ];
        if (quote.exchDisp && !usExchanges.includes(quote.exchDisp)) return false;

        return true;
      })
      .slice(0, 10) // Limit to top 10 results
      .map((quote) => ({
        symbol: quote.symbol,
        name: quote.shortname || quote.longname || quote.symbol,
        exchange: quote.exchDisp,
        sector: quote.sector,
      }));

    console.log(`[search] Found ${results.length} results for "${query}"`);

    // Cache non-empty results for 1 hour
    if (results.length > 0) {
      try {
        await setCached(cacheKey, results, 3600);
      } catch (cacheError) {
        console.warn('[search] Cache write failed:', cacheError);
        // Continue without caching
      }
    }

    return NextResponse.json({
      results,
      cached: false
    }, { headers: getRateLimitHeaders(rateLimitResult) });
  } catch (error) {
    console.error('[search] Error fetching from Yahoo Finance:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch search results',
        results: []
      },
      { status: 500, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }
}
