import { NextResponse } from 'next/server';

import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';

type RateLimitHeaders = ReturnType<typeof getRateLimitHeaders>;

type AuthResult = string | NextResponse;

function authenticate(request: Request, headers: RateLimitHeaders): AuthResult {
  const userId = request.headers.get('x-user-id')?.trim();

  if (!userId) {
    return NextResponse.json({ error: 'Missing user identifier' }, { status: 400, headers });
  }

  return userId;
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
