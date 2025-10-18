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
        dividendsPerShare: 2,
      },
    ];

    const yahooSupplement = {
      symbol: 'AAPL',
      companyName: 'Apple Inc.',
      currency: 'USD',
      exchangeName: 'NASDAQ',
      source: 'yahoo' as const,
      fetchedAt: new Date().toISOString(),
      metrics: {
        currentPrice: 100,
        change: 0.5,
        changePercent: 0.5,
        trailingPE: 21,
        dividendYield: 0.018,
        payoutRatio: 0.4,
        roeActual: 0.22,
        revenueCagr3Y: 0.12,
        earningsCagr3Y: 0.15,
        debtToEquityActual: 0.6,
        freeCashflowPayoutRatio: 0.35,
      },
    };

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(metadata))
      .mockResolvedValueOnce(buildResponse(priceHistory))
      .mockResolvedValueOnce(buildResponse(fundamentalsHistory));

    mockFetchYahooFundamentals.mockResolvedValueOnce(yahooSupplement);

    const { fetchFundamentalsWithFallback } = await import('../fundamentals');

    const result = await fetchFundamentalsWithFallback('AAPL');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mockFetchYahooFundamentals).toHaveBeenCalledWith('AAPL', undefined);
    expect(result.source).toBe('tiingo');
    expect(result.symbol).toBe('AAPL');
    expect(result.metrics.trailingPE).toBe(20);
    expect(result.metrics.dividendYield).toBeCloseTo(0.02);
    expect(result.metrics.payoutRatio).toBeCloseTo(0.4);
    expect(result.metrics.revenueCagr3Y).toBeCloseTo(0.12);
    expect(result.metrics.roeActual).toBeCloseTo(0.22);
    expect(result.metrics.payoutRatio).toBeCloseTo(0.4);
  });

  it('supplements Tiingo fundamentals with Yahoo dividend metrics when missing', async () => {
    const metadata = {
      ticker: 'KO',
      name: 'Coca-Cola Company',
      exchangeCode: 'NYSE',
    };

    const priceHistory = [
      {
        close: 60,
        adjClose: 59,
      },
    ];

    const fundamentalsHistory = [
      {
        date: '2024-12-31',
        peRatio: 25,
        pbRatio: 6,
        trailingPEG1Y: 2,
        marketCap: 500_000_000,
        enterpriseVal: 600_000_000,
        // dividendsPerShare intentionally omitted to force supplement
      },
    ];

    const yahooResult = {
      symbol: 'KO',
      companyName: 'Coca-Cola Company',
      currency: 'USD',
      exchangeName: 'NYSE',
      source: 'yahoo' as const,
      fetchedAt: new Date().toISOString(),
      metrics: {
        currentPrice: 60,
        change: 0.5,
        changePercent: 0.8,
        trailingPE: 24,
        dividendYield: 0.031,
        payoutRatio: 0.55,
      },
    };

    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(buildResponse(metadata))
      .mockResolvedValueOnce(buildResponse(priceHistory))
      .mockResolvedValueOnce(buildResponse(fundamentalsHistory));

    mockFetchYahooFundamentals.mockResolvedValueOnce(yahooResult);

    const { fetchFundamentalsWithFallback } = await import('../fundamentals');

    const result = await fetchFundamentalsWithFallback('KO');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mockFetchYahooFundamentals).toHaveBeenCalledWith('KO', undefined);
    expect(result.source).toBe('tiingo');
    expect(result.metrics.dividendYield).toBeCloseTo(0.031);
    expect(result.metrics.payoutRatio).toBeCloseTo(0.55);
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
        dividendYield: 0.03,
        revenueCagr3Y: 0.08,
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
    expect(result.metrics.dividendYield).toBe(0.03);
    expect(result.metrics.revenueCagr3Y).toBeCloseTo(0.08);
  });
});
