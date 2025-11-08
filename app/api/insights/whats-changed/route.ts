import { NextResponse } from 'next/server';

import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';
import { generateWhatsChangedUpdate } from '@/lib/ai/generateWhatsChangedUpdate';
import { getCached, setCached } from '@/lib/cache';
import { authenticate } from '@/lib/auth';

type WhatsChangedFacts = {
  generatedAt: string;
  investorType: 'growth' | 'value' | 'income' | null;
  experienceLevel: 'beginner' | 'intermediate' | 'expert' | null;
  appVersion?: string;
  watchlist: {
    count: number;
    tickers: string[];
    recentlyAdded?: { ticker: string; name: string; addedAt: string }[];
    recentlyAnalyzed?: { ticker: string; name: string; analyzedAt: string }[];
    updatedAt: string;
  };
  lastValuation?: {
    ticker: string;
    companyName: string;
    recommendation: 'buy' | 'hold' | 'pass';
    savedAt: string;
  };
};

type BannerCacheEntry = {
  message: string;
  createdAt: string;
  factsHash: string;
  model?: string;
};

const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const CACHE_KEY_PREFIX = 'whats-changed:';

const hashFacts = async (facts: WhatsChangedFacts): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(facts));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export async function POST(request: Request) {
  const rateLimitResult = await checkRateLimit(request);

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) },
    );
  }

  // Authentication (supports API key or JWT)
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    // Authentication failed, return the error response
    return authResult;
  }
  // authResult is AuthResult with userId and method

  let facts: WhatsChangedFacts;
  try {
    facts = (await request.json()) as WhatsChangedFacts;
  } catch (_error) {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: getRateLimitHeaders(rateLimitResult) },
    );
  }

  try {
    const factsHash = await hashFacts(facts);
    const cacheKey = `${CACHE_KEY_PREFIX}${factsHash}`;

    const cached = await getCached<BannerCacheEntry>(cacheKey);
    if (cached) {
      return NextResponse.json(
        { data: cached },
        { status: 200, headers: getRateLimitHeaders(rateLimitResult) },
      );
    }

    const result = await generateWhatsChangedUpdate(facts);

    const cacheEntry: BannerCacheEntry = {
      message: result.message,
      createdAt: result.createdAt,
      factsHash,
      model: result.model,
    };

    await setCached(cacheKey, cacheEntry, CACHE_TTL_SECONDS);

    return NextResponse.json(
      { data: cacheEntry },
      { status: 200, headers: getRateLimitHeaders(rateLimitResult) },
    );
  } catch (error) {
    console.error('[whats-changed] Failed to generate banner:', error);
    return NextResponse.json(
      { error: 'Failed to generate update' },
      { status: 500, headers: getRateLimitHeaders(rateLimitResult) },
    );
  }
}
