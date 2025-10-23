import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

vi.mock('@/lib/actions/finnhub.actions', () => ({
    getNews: vi.fn(),
}));

import { getNews } from '@/lib/actions/finnhub.actions';

const mockedGetNews = vi.mocked(getNews);
const originalFetch = global.fetch;

describe('/api/news', () => {
    const mockArticles: MarketNewsArticle[] = [
        {
            id: 1,
            headline: 'Sample headline',
            summary: 'Summary of the article',
            source: 'Finnhub',
            url: 'https://example.com/article',
            datetime: 1_700_000_000,
            category: 'company',
            related: 'AAPL',
            image: 'https://example.com/image.jpg',
        },
    ];

    beforeAll(() => {
        global.fetch = vi.fn() as unknown as typeof fetch;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReset?.();
    });

    afterEach(() => {
        (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReset?.();
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it('returns 422 for invalid symbols', async () => {
        const request = new NextRequest('http://localhost:3000/api/news?symbols=BAD$');
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.error).toContain('invalid');
        expect(mockedGetNews).not.toHaveBeenCalled();
    });

    it('delegates to Finnhub when available', async () => {
        mockedGetNews.mockResolvedValue(mockArticles);

        const request = new NextRequest('http://localhost:3000/api/news?symbols=aapl, msft ,AAPL');
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(mockedGetNews).toHaveBeenCalledWith(['AAPL', 'MSFT']);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(body.data).toHaveLength(1);
        expect(body.data[0]).toMatchObject({
            id: '1',
            ticker: 'AAPL',
            headline: 'Sample headline',
            imageUrl: 'https://example.com/image.jpg',
        });
    });

    it('falls back to Yahoo when Finnhub key is missing', async () => {
        mockedGetNews.mockRejectedValue(new Error('FINNHUB API key is not configured'));
        const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
        fetchMock
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                news: [
                    {
                        uuid: 'yahoo-1',
                        title: 'Fallback headline',
                        summary: 'Fallback summary',
                        link: 'https://example.com/fallback',
                        publisher: 'Yahoo Finance',
                        providerPublishTime: 1_700_000_100,
                        thumbnail: {
                            resolutions: [{ url: 'https://example.com/image-fallback.jpg' }],
                        },
                        relatedTickers: ['MSFT', 'ZD'],
                    },
                ],
            }),
        })
            .mockResolvedValue({
                ok: true,
                json: async () => ({ news: [] }),
            });

        const request = new NextRequest('http://localhost:3000/api/news?symbols=MSFT');
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(global.fetch).toHaveBeenCalled();
        expect(body.data).toHaveLength(1);
        expect(body.data[0].ticker).toBe('MSFT');
        expect(body.data[0].headline).toBe('Fallback headline');
        expect(body.data[0].imageUrl).toBe('https://example.com/image-fallback.jpg');
    });

    it('detects tickers inside article text when relatedTickers missing', async () => {
        mockedGetNews.mockRejectedValue(new Error('FINNHUB API key is not configured'));
        const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
        fetchMock
            .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                news: [
                    {
                        uuid: 'article-2',
                        title: 'Reddit, Inc. (RDDT): A Bull Case Theory',
                        summary: 'Deep dive on Reddit (RDDT) and peers.',
                        link: 'https://example.com/rddt',
                        publisher: 'Custom',
                        providerPublishTime: 1_700_000_200,
                    },
                ],
            }),
        })
            .mockResolvedValue({
                ok: true,
                json: async () => ({ news: [] }),
            });

        const request = new NextRequest('http://localhost:3000/api/news?symbols=RDDT');
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data).toHaveLength(1);
        expect(body.data[0].ticker).toBe('RDDT');
        expect(body.data[0].url).toBe('https://example.com/rddt');
    });

    it('fills remaining slots with general market news when watchlist empty', async () => {
        mockedGetNews.mockRejectedValue(new Error('FINNHUB API key is not configured'));
        const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ news: [] }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    news: [
                        {
                            uuid: 'general-1',
                            title: 'S&P 500 rises on tech strength',
                            link: 'https://example.com/market',
                            publisher: 'Reuters',
                            providerPublishTime: 1_700_000_300,
                        },
                    ],
                }),
            });

        const request = new NextRequest('http://localhost:3000/api/news?symbols=ZM');
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(global.fetch).toHaveBeenCalled();
        expect(body.data).toHaveLength(1);
        expect(body.data[0].ticker).toBe('MARKET');
    });

    it('limits general market news to two articles per source', async () => {
        mockedGetNews.mockRejectedValue(new Error('FINNHUB API key is not configured'));
        const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ news: [] }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    news: [1, 2, 3, 4].map((index) => ({
                        uuid: `barrons-${index}`,
                        title: `Barrons headline ${index}`,
                        link: `https://example.com/${index}`,
                        publisher: 'Barrons.com',
                        providerPublishTime: 1_700_001_000 + index,
                    })),
                }),
            });

        const request = new NextRequest('http://localhost:3000/api/news');
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.length).toBeLessThanOrEqual(2);
        expect(new Set(body.data.map((item: any) => item.headline)).size).toBe(body.data.length);
    });

    it('returns 503 when Finnhub key missing and Yahoo returns no news', async () => {
        mockedGetNews.mockRejectedValue(new Error('FINNHUB API key is not configured'));
        const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ news: [] }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ news: [] }),
            });

        const request = new NextRequest('http://localhost:3000/api/news');
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body.error).toContain('FINNHUB_API_KEY');
    });

    it('returns 502 when both providers fail with non-auth error', async () => {
        mockedGetNews.mockRejectedValue(new Error('Finnhub down'));
        (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Yahoo error'));

        const request = new NextRequest('http://localhost:3000/api/news?symbols=TSLA');
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body.error).toContain('Failed to load news');
    });
});
