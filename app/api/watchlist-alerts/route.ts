import { NextResponse } from 'next/server';

import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';

type RateLimitHeaders = ReturnType<typeof getRateLimitHeaders>;

type AuthResult = string | NextResponse;

function authenticate(request: Request, headers: RateLimitHeaders): AuthResult {
  const apiKey = request.headers.get('x-api-key');
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey) {
    console.error('[watchlist-alerts] INTERNAL_API_KEY not configured');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500, headers });
  }

  if (!apiKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const deviceId = request.headers.get('x-device-id')?.trim();

  if (!deviceId) {
    return NextResponse.json({ error: 'Missing device identifier' }, { status: 400, headers });
  }

  return deviceId;
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

  // MongoDB removed - return empty array to allow client-side local storage fallback
  return NextResponse.json({ data: [] }, { status: 200, headers });
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
    ticker?: string;
    changePercent?: number;
    threshold?: number;
    message?: string;
    triggeredAt?: string;
    read?: boolean;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers });
  }

  const ticker = payload.ticker?.trim().toUpperCase();
  const changePercent = Number(payload.changePercent);
  const threshold = Number(payload.threshold);
  const message = payload.message?.trim();
  const triggeredAt = payload.triggeredAt ? new Date(payload.triggeredAt).toISOString() : new Date().toISOString();
  const read = Boolean(payload.read);

  if (!ticker || !Number.isFinite(changePercent) || Number.isNaN(threshold) || !message) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400, headers });
  }

  // MongoDB removed - return the alert data to allow client-side local storage
  const alert = {
    id: `${ticker}-${Date.now()}`,
    ticker,
    changePercent,
    threshold,
    message,
    triggeredAt,
    read,
  };

  return NextResponse.json({ data: alert }, { status: 201, headers });
}

export async function PATCH(request: Request) {
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

  // MongoDB removed - return success to allow client-side local storage
  return NextResponse.json({ data: { success: true } }, { status: 200, headers });
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

  // MongoDB removed - return success to allow client-side local storage
  return NextResponse.json({ data: { success: true } }, { status: 200, headers });
}
