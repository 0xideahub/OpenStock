import { NextResponse } from 'next/server';

import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';
import { authenticate } from '@/lib/auth';

export async function GET(request: Request) {
  const rateLimitResult = await checkRateLimit(request);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  // Authentication (supports API key or JWT)
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    // Authentication failed, return the error response
    return authResult;
  }
  // authResult is AuthResult with userId and method

  const headers = getRateLimitHeaders(rateLimitResult);

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

  // Authentication (supports API key or JWT)
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    // Authentication failed, return the error response
    return authResult;
  }
  // authResult is AuthResult with userId and method

  const headers = getRateLimitHeaders(rateLimitResult);

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

  // Authentication (supports API key or JWT)
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    // Authentication failed, return the error response
    return authResult;
  }
  // authResult is AuthResult with userId and method

  const headers = getRateLimitHeaders(rateLimitResult);

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

  // Authentication (supports API key or JWT)
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    // Authentication failed, return the error response
    return authResult;
  }
  // authResult is AuthResult with userId and method

  const headers = getRateLimitHeaders(rateLimitResult);

  // MongoDB removed - return success to allow client-side local storage
  return NextResponse.json({ data: { success: true } }, { status: 200, headers });
}
