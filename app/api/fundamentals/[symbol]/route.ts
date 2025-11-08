import { NextResponse } from 'next/server';

import { fetchFundamentalsWithFallback } from '@/lib/services/fundamentals';
import { checkRateLimit, getRateLimitHeaders } from '@/lib/ratelimit';
import { authenticate } from '@/lib/auth';

export const revalidate = 0;

export async function GET(
    request: Request,
    context: { params: Promise<{ symbol?: string }> },
) {
    // Rate Limiting Check
    const rateLimitResult = await checkRateLimit(request);

    if (!rateLimitResult.success) {
        console.warn('[api] Rate limit exceeded');
        return NextResponse.json(
            {
                error: 'Rate limit exceeded. Please try again later.',
            },
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

    const resolvedParams = await context.params;
    const symbol = resolvedParams.symbol?.trim();

    if (!symbol) {
        return NextResponse.json(
            {
                error: 'Ticker symbol is required',
            },
            {
                status: 400,
            },
        );
    }

    try {
        const fundamentals = await fetchFundamentalsWithFallback(symbol);

        return NextResponse.json(
            {
                data: fundamentals,
            },
            {
                status: 200,
                headers: getRateLimitHeaders(rateLimitResult),
            },
        );
    } catch (error) {
        console.error(`[api] fundamentals fetch failed for ${symbol}:`, error);

        let message = 'Failed to fetch fundamentals';

        if (error instanceof Error) {
            message = error.message;
            // Log the full error stack for debugging
            console.error('[api] Error stack:', error.stack);
        }

        // If it's an AggregateError (both Tiingo and Yahoo failed), provide details
        if (error instanceof AggregateError) {
            console.error('[api] Both Tiingo and Yahoo failed:');
            error.errors.forEach((err, idx) => {
                console.error(`[api]   Source ${idx + 1}:`, err instanceof Error ? err.message : err);
            });
            message = `Failed to fetch fundamentals for ${symbol} from all sources (Tiingo and Yahoo)`;
        }

        return NextResponse.json(
            {
                error: message,
            },
            {
                status: 502,
                headers: getRateLimitHeaders(rateLimitResult),
            },
        );
    }
}
