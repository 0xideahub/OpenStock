import { NextRequest, NextResponse } from 'next/server';

import { getNews } from '@/lib/actions/finnhub.actions';

const SYMBOL_REGEX = /^[A-Z0-9.\-]{1,10}$/;
const MAX_ARTICLES = 6;

const YAHOO_BASE_URL = 'https://query2.finance.yahoo.com/v1/finance/search';
const YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; OpenStock/1.0)',
    Accept: 'application/json',
};

type YahooNewsThumbnail = {
    resolutions?: Array<{ url?: string }>;
};

type YahooNewsEntity = {
    entityId?: string;
    symbol?: string;
    entityType?: string;
};

type YahooNewsArticle = {
    uuid?: string;
    title?: string;
    summary?: string;
    link?: string;
    publisher?: string;
    providerPublishTime?: number;
    thumbnail?: YahooNewsThumbnail;
    relatedTickers?: string[];
    symbols?: string[];
    entities?: YahooNewsEntity[];
};

type YahooSearchResponse = {
    news?: YahooNewsArticle[];
};

const firstImageUrl = (thumbnail?: YahooNewsThumbnail): string | undefined => {
    return thumbnail?.resolutions?.find((item) => Boolean(item.url))?.url;
};

const normalizeSymbols = (param: string | null): string[] | undefined => {
    if (!param) return undefined;
    const symbols = param
        .split(',')
        .map((sym) => sym.trim().toUpperCase())
        .filter(Boolean);

    if (symbols.length === 0) {
        return undefined;
    }

    const hasInvalid = symbols.some((sym) => !SYMBOL_REGEX.test(sym));
    if (hasInvalid) {
        throw new Error('INVALID_SYMBOLS');
    }

    return Array.from(new Set(symbols)).slice(0, 12);
};

const toIsoString = (timestampSeconds?: number): string | null => {
    if (!timestampSeconds || Number.isNaN(timestampSeconds)) return null;
    return new Date(timestampSeconds * 1000).toISOString();
};

const normalizeArticle = (article: MarketNewsArticle) => ({
    id: String(article.id),
    ticker: article.related || '',
    headline: article.headline,
    summary: article.summary,
    source: article.source,
    url: article.url,
    imageUrl: article.image || null,
    publishedAt: toIsoString(article.datetime),
});

const normalizeYahooArticle = (article: YahooNewsArticle, ticker: string): MarketNewsArticle => ({
    id: article.uuid ?? `${ticker}:${article.link ?? Math.random().toString(36).slice(2)}`,
    headline: article.title ?? 'Latest market update',
    summary: article.summary ?? '',
    source: article.publisher ?? 'Yahoo Finance',
    url: article.link ?? 'https://finance.yahoo.com',
    datetime: article.providerPublishTime ?? Math.floor(Date.now() / 1000),
    image: firstImageUrl(article.thumbnail) ?? '',
    category: 'company',
    related: ticker,
});

const parseTickersFromText = (text?: string): string[] => {
    if (!text) return [];
    const matches = text.match(/\(([A-Z]{1,5}(?:\.[A-Z]{1,2})?)\)/g) ?? [];
    return matches
        .map((match) => match.replace(/[()]/g, ''))
        .filter(Boolean);
};

const extractTickersFromArticle = (article: YahooNewsArticle): string[] => {
    const tickers = new Set<string>();
    article.relatedTickers?.forEach((ticker) => ticker && tickers.add(ticker.toUpperCase()));
    article.symbols?.forEach((ticker) => ticker && tickers.add(ticker.toUpperCase()));
    article.entities
        ?.filter((entity) => entity?.entityType === 'TICKER')
        .forEach((entity) => {
            const symbol = entity.symbol || entity.entityId;
            if (symbol) {
                tickers.add(symbol.toUpperCase());
            }
        });
    parseTickersFromText(article.title).forEach((ticker) => tickers.add(ticker.toUpperCase()));
    parseTickersFromText(article.summary).forEach((ticker) => tickers.add(ticker.toUpperCase()));
    return Array.from(tickers);
};

const fetchYahooWatchlistNews = async (
    symbols: string[],
    maxArticles: number
): Promise<MarketNewsArticle[]> => {
    const targets = symbols && symbols.length > 0 ? symbols.slice(0, 6) : [];
    if (targets.length === 0) {
        return [];
    }
    const watchlistSet = new Set(targets);
    const perTickerCounts = new Map<string, number>();
    const collected: MarketNewsArticle[] = [];
    const seenIds = new Set<string>();

    for (const target of targets) {
        try {
            const url = new URL(YAHOO_BASE_URL);
            url.searchParams.set('q', target);
            url.searchParams.set('quotesCount', '1');
            url.searchParams.set('newsCount', String(MAX_ARTICLES));

            const response = await fetch(url.toString(), {
                headers: YAHOO_HEADERS,
                cache: 'no-store',
            });

            if (!response.ok) {
                console.warn(`[news] Yahoo search failed for ${target}: ${response.status}`);
                continue;
            }

            const payload = (await response.json()) as YahooSearchResponse;
            for (const article of payload.news ?? []) {
                const matchingTickers = extractTickersFromArticle(article).filter((ticker) =>
                    watchlistSet.has(ticker)
                );

                if (matchingTickers.length === 0) {
                    continue;
                }

                for (const ticker of matchingTickers) {
                    const currentCount = perTickerCounts.get(ticker) ?? 0;
                    if (currentCount >= 2) {
                        continue;
                    }

                    const normalized = normalizeYahooArticle(article, ticker);
                    if (!normalized.url) {
                        continue;
                    }

                    const uniqueId = `${normalized.id}-${ticker}`;
                    if (seenIds.has(uniqueId)) {
                        continue;
                    }

                    collected.push(normalized);
                    perTickerCounts.set(ticker, currentCount + 1);
                    seenIds.add(uniqueId);

                    if (collected.length >= maxArticles) {
                        return collected
                            .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
                            .slice(0, maxArticles);
                    }
                }
            }
        } catch (error) {
            console.warn(`[news] Yahoo request error for ${target}:`, error);
        }
    }

    return collected
        .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
        .slice(0, maxArticles);
};

const fetchYahooGeneralNews = async (
    excludeIds: Set<string>,
    maxArticles: number
): Promise<MarketNewsArticle[]> => {
    const queries = ['^GSPC', '^IXIC', 'market news today'];
    const collected: MarketNewsArticle[] = [];

    for (const query of queries) {
        try {
            const url = new URL(YAHOO_BASE_URL);
            url.searchParams.set('q', query);
            url.searchParams.set('quotesCount', '0');
            url.searchParams.set('newsCount', String(maxArticles));

            const response = await fetch(url.toString(), {
                headers: YAHOO_HEADERS,
                cache: 'no-store',
            });

            if (!response.ok) {
                console.warn(`[news] Yahoo general search failed for query "${query}": ${response.status}`);
                continue;
            }

            const payload = (await response.json()) as YahooSearchResponse;
            for (const article of payload.news ?? []) {
                const tickers = extractTickersFromArticle(article);
                const assignedTicker = tickers[0] ?? 'MARKET';
                const normalized = normalizeYahooArticle(article, assignedTicker);
                const uniqueId = `${normalized.id}-${assignedTicker}`;

                if (excludeIds.has(uniqueId)) {
                    continue;
                }

                collected.push(normalized);
                excludeIds.add(uniqueId);

                if (collected.length >= maxArticles) {
                    return collected
                        .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
                        .slice(0, maxArticles);
                }
            }
        } catch (error) {
            console.warn('[news] Yahoo general request error:', error);
        }
    }

    return collected
        .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
        .slice(0, maxArticles);
};

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');

    let symbols: string[] | undefined;
    try {
        symbols = normalizeSymbols(symbolsParam);
    } catch (err) {
        if ((err as Error).message === 'INVALID_SYMBOLS') {
            return NextResponse.json(
                { error: 'One or more symbols are invalid. Use uppercase letters, numbers, dot or dash.' },
                { status: 422 }
            );
        }
        return NextResponse.json({ error: 'Failed to load news' }, { status: 400 });
    }

    let articles: MarketNewsArticle[] = [];
    let primaryError: unknown;

    try {
        articles = await getNews(symbols);
    } catch (error) {
        primaryError = error;
        console.warn('[news] Finnhub getNews failed, attempting Yahoo fallback:', error);
    }

    if (articles.length === 0) {
        try {
            const watchlistArticles = await fetchYahooWatchlistNews(symbols ?? [], MAX_ARTICLES);
            articles = watchlistArticles;

            if (articles.length < MAX_ARTICLES) {
                const excludeIds = new Set(
                    watchlistArticles.map((article) => `${article.id}-${article.related}`)
                );
                const generalArticles = await fetchYahooGeneralNews(
                    excludeIds,
                    MAX_ARTICLES - articles.length
                );
                articles = [...articles, ...generalArticles];
            }
        } catch (fallbackError) {
            console.error('[news] Yahoo fallback failed:', fallbackError);
            primaryError = primaryError ?? fallbackError;
        }
    }

    if (articles.length === 0) {
        console.error('GET /api/news error:', primaryError);
        if (
            primaryError instanceof Error &&
            primaryError.message &&
            primaryError.message.includes('FINNHUB API key')
        ) {
            return NextResponse.json(
                { error: 'News feed unavailable: FINNHUB_API_KEY is not configured.' },
                { status: 503 }
            );
        }

        return NextResponse.json({ error: 'Failed to load news' }, { status: 502 });
    }

    const payload = articles.slice(0, MAX_ARTICLES).map(normalizeArticle);

    return NextResponse.json(
        { data: payload },
        {
            status: 200,
            headers: {
                'Cache-Control': 's-maxage=300, stale-while-revalidate=60',
            },
        }
    );
}
