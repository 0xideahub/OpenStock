import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = { ...process.env };
const fetchYahooDividendHistoryMock = vi.fn();

vi.mock('@/lib/yahoo/dividends', () => {
  class MockYahooDividendNotFoundError extends Error {}

  return {
    fetchYahooDividendHistory: fetchYahooDividendHistoryMock,
    YahooDividendNotFoundError: MockYahooDividendNotFoundError,
  };
});

const buildContext = (symbol: string) => ({
  params: Promise.resolve({ symbol }),
});

const buildRequest = (symbol: string, apiKey: string) =>
  new NextRequest(`http://test.local/api/dividend-history/${symbol}`, {
    headers: new Headers({
      'x-api-key': apiKey,
    }),
  });

describe('GET /api/dividend-history/[symbol]', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    fetchYahooDividendHistoryMock.mockReset();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    fetchYahooDividendHistoryMock.mockReset();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('returns 401 when API key header is missing', async () => {
    process.env.INTERNAL_API_KEY = 'secret';
    const { GET } = await import('./route');
    const request = new NextRequest('http://test.local/api/dividend-history/T', {
      headers: {},
    });

    const response = await GET(request, buildContext('T'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns 500 when TIINGO_API_KEY is not configured and Yahoo fails', async () => {
    delete process.env.TIINGO_API_KEY;
    process.env.INTERNAL_API_KEY = 'secret';
    const { GET } = await import('./route');

    fetchYahooDividendHistoryMock.mockRejectedValue(new Error('Yahoo failure'));

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await GET(buildRequest('T', 'secret'), buildContext('T'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch dividend history' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns dividend payments when Yahoo responds successfully', async () => {
    process.env.INTERNAL_API_KEY = 'secret';
    const { GET } = await import('./route');

    const now = new Date().toISOString();

    fetchYahooDividendHistoryMock.mockResolvedValue({
      symbol: 'T',
      data: [
        { date: '2024-07-15', amount: 0.28, exDate: '2024-07-15', payDate: '2024-07-15' },
        { date: '2024-01-15', amount: 0.27, exDate: '2024-01-15', payDate: '2024-01-15' },
      ],
      fetchedAt: now,
    });

    const response = await GET(buildRequest('T', 'secret'), buildContext('T'));

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.symbol).toBe('T');
    expect(body.data).toEqual([
      {
        date: '2024-07-15',
        amount: 0.28,
        exDate: '2024-07-15',
        payDate: '2024-07-15',
      },
      {
        date: '2024-01-15',
        amount: 0.27,
        exDate: '2024-01-15',
        payDate: '2024-01-15',
      },
    ]);
    expect(body.fetchedAt).toBe(now);
  });

  it('maps Yahoo not found error into a 404 response without hitting Tiingo', async () => {
    process.env.INTERNAL_API_KEY = 'secret';
    const { GET } = await import('./route');
    const { YahooDividendNotFoundError } = await import('@/lib/yahoo/dividends');

    fetchYahooDividendHistoryMock.mockRejectedValue(new YahooDividendNotFoundError('not found'));

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const response = await GET(buildRequest('XYZ', 'secret'), buildContext('XYZ'));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Dividend history not available' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to Tiingo when Yahoo fails with a generic error', async () => {
    process.env.TIINGO_API_KEY = 'token';
    process.env.INTERNAL_API_KEY = 'secret';
    const { GET } = await import('./route');

    fetchYahooDividendHistoryMock.mockRejectedValue(new Error('Yahoo down'));

    const mockPayload = [
      { date: '2024-01-15', divCash: 0.27 },
      { date: '2024-07-15', divCash: 0.28 },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await GET(buildRequest('ABC', 'secret'), buildContext('ABC'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.symbol).toBe('ABC');
    expect(body.data).toEqual([
      { date: '2024-07-15', amount: 0.28, exDate: '2024-07-15' },
      { date: '2024-01-15', amount: 0.27, exDate: '2024-01-15' },
    ]);
  });
});
