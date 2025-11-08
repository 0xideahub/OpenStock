import { NextResponse } from 'next/server';

import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';

type RateLimitHeaders = ReturnType<typeof getRateLimitHeaders>;

type AuthResult = string | NextResponse;

/**
 * Authenticate user from JWT token
 *
 * TODO: When MongoDB is enabled, implement proper JWT verification:
 * 1. Extract Bearer token from Authorization header
 * 2. Verify token with Clerk: await clerkClient.verifyToken(token)
 * 3. Return verified user ID from token.sub
 * 4. Return 401 Unauthorized if token is missing or invalid
 *
 * Current implementation: Stub that returns success for local storage fallback
 */
function authenticate(request: Request, headers: RateLimitHeaders): AuthResult {
  const authHeader = request.headers.get('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing authentication token' }, { status: 401, headers });
  }

  // TODO: Verify JWT token with Clerk when MongoDB is enabled
  // For now, return a placeholder user ID since backend is a stub
  return 'stub-user-id';
}

export async function GET(request: Request) {
  const rateLimitResult = await checkRateLimit(request);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  const headers = getRateLimitHeaders(rateLimitResult);
  const authResult = authenticate(request, headers);
  if (typeof authResult !== 'string') {
    return authResult;
  }

  // MongoDB removed - return empty watchlist to allow client-side local storage fallback
  return NextResponse.json({ items: [] }, { status: 200, headers });
}

export async function POST(request: Request) {
  const rateLimitResult = await checkRateLimit(request);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  const headers = getRateLimitHeaders(rateLimitResult);
  const authResult = authenticate(request, headers);
  if (typeof authResult !== 'string') {
    return authResult;
  }

  let payload: {
    symbol?: string;
    company?: string;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers });
  }

  const symbol = payload.symbol?.trim().toUpperCase();
  const company = payload.company?.trim();

  if (!symbol || !company) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400, headers });
  }

  // MongoDB removed - return the item data to allow client-side local storage
  const item = {
    id: `${symbol}-${Date.now()}`,
    symbol,
    company,
    addedAt: new Date().toISOString(),
  };

  return NextResponse.json(item, { status: 201, headers });
}

export async function DELETE(request: Request) {
  const rateLimitResult = await checkRateLimit(request);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  const headers = getRateLimitHeaders(rateLimitResult);
  const authResult = authenticate(request, headers);
  if (typeof authResult !== 'string') {
    return authResult;
  }

  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol')?.trim().toUpperCase();

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol parameter' }, { status: 400, headers });
  }

  // MongoDB removed - return success to allow client-side local storage
  return NextResponse.json({ success: true }, { status: 200, headers });
}
