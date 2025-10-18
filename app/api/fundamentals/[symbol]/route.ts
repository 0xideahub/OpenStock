import { NextResponse } from 'next/server';

import { fetchFundamentalsWithFallback } from '@/lib/services/fundamentals';

export const revalidate = 0;

export async function GET(
    _request: Request,
    context: { params: Promise<{ symbol?: string }> },
) {
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
            },
        );
    } catch (error) {
        console.error('[api] fundamentals fetch failed', error);

        const message =
            error instanceof Error ? error.message : 'Failed to fetch fundamentals';

        return NextResponse.json(
            {
                error: message,
            },
            {
                status: 502,
            },
        );
    }
}
