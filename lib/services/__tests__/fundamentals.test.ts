import { vi, describe, beforeEach, afterEach, expect, it } from 'vitest';

const mockFetchYahooFundamentals = vi.fn();

vi.mock('../../yahoo/fundamentals', () => ({
  fetchYahooFundamentals: mockFetchYahooFundamentals,
}));

const buildResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  });

describe('fetchFundamentalsWithFallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('OPENSTOCK_API_BASE_URL', '');
    vi.stubEnv('TIINGO_API_KEY', 'test-key');
    mockFetchYahooFundamentals.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns Tiingo fundamentals when Tiingo responds successfully', async () => {
    const metadata = {
      ticker: 'AAPL',
      name: 'Apple Inc.',
      exchangeCode: 'NASDAQ',
    };

    const priceHistory = [
      {
        close: 100,
        adjClose: 98,
      },
    ];

    const fundamentalsHistory = [
      {
        date: '2024-12-31',
        peRatio: 20,
        pbRatio: 5,
        trailingPEG1Y: 1.5,
        marketCap: 1_000_000_000,
        enterpriseVal: 1_200_000_000,
      },
    ];

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(metadata))
      .mockResolvedValueOnce(buildResponse(priceHistory))
      .mockResolvedValueOnce(buildResponse(fundamentalsHistory));

    const { fetchFundamentalsWithFallback } = await import('../fundamentals');

    const result = await fetchFundamentalsWithFallback('AAPL');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mockFetchYahooFundamentals).not.toHaveBeenCalled();
    expect(result.source).toBe('tiingo');
    expect(result.symbol).toBe('AAPL');
    expect(result.metrics.trailingPE).toBe(20);
  });

  it('falls back to Yahoo when Tiingo fails', async () => {
    const yahooResult = {
      symbol: 'DENN',
      companyName: "Denny's Corporation",
      currency: 'USD',
      exchangeName: 'NASDAQ',
      source: 'yahoo' as const,
      fetchedAt: new Date().toISOString(),
      metrics: {
        currentPrice: 10,
        change: 0.1,
        changePercent: 0.5,
        trailingPE: 15,
      },
    };

    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Tiingo offline'));
    mockFetchYahooFundamentals.mockResolvedValueOnce(yahooResult);

    const { fetchFundamentalsWithFallback } = await import('../fundamentals');

    const result = await fetchFundamentalsWithFallback('DENN');

    expect(mockFetchYahooFundamentals).toHaveBeenCalledWith('DENN', undefined);
    expect(result.source).toBe('yahoo');
    expect(result.symbol).toBe('DENN');
    expect(result.metrics.trailingPE).toBe(15);
  });
});
