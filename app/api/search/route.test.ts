import { GET } from './route';
import { NextRequest } from 'next/server';

// Mock Redis
jest.mock('@/lib/redis', () => ({
  redis: {
    get: jest.fn(),
    setex: jest.fn(),
  },
}));

// Mock auth middleware
jest.mock('@/middleware/auth', () => ({
  withAuth: (handler: any) => handler,
}));

// Mock rate limit middleware
jest.mock('@/middleware/rateLimit', () => ({
  withRateLimit: (handler: any) => handler,
}));

describe('/api/search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('returns 400 if query parameter is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/search');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Query parameter');
  });

  it('returns cached results if available', async () => {
    const { redis } = require('@/lib/redis');
    const cachedResults = [
      { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
    ];
    redis.get.mockResolvedValue(JSON.stringify(cachedResults));

    const req = new NextRequest('http://localhost:3000/api/search?q=apple');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.cached).toBe(true);
    expect(data.results).toEqual(cachedResults);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches from Yahoo Finance if not cached', async () => {
    const { redis } = require('@/lib/redis');
    redis.get.mockResolvedValue(null);

    const yahooResponse = {
      quotes: [
        {
          symbol: 'AAPL',
          shortname: 'Apple Inc.',
          quoteType: 'EQUITY',
          exchDisp: 'NASDAQ',
          sector: 'Technology'
        }
      ]
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => yahooResponse
    });

    const req = new NextRequest('http://localhost:3000/api/search?q=apple');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.cached).toBe(false);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].symbol).toBe('AAPL');
    expect(data.results[0].name).toBe('Apple Inc.');
  });

  it('filters out non-equity results', async () => {
    const { redis } = require('@/lib/redis');
    redis.get.mockResolvedValue(null);

    const yahooResponse = {
      quotes: [
        { symbol: 'AAPL', shortname: 'Apple Inc.', quoteType: 'EQUITY', exchDisp: 'NASDAQ' },
        { symbol: 'SPY', shortname: 'SPDR S&P 500 ETF', quoteType: 'ETF', exchDisp: 'NYSE' },
        { symbol: 'VFIAX', shortname: 'Vanguard 500', quoteType: 'MUTUALFUND', exchDisp: 'NASDAQ' }
      ]
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => yahooResponse
    });

    const req = new NextRequest('http://localhost:3000/api/search?q=apple');
    const response = await GET(req);
    const data = await response.json();

    expect(data.results).toHaveLength(1);
    expect(data.results[0].symbol).toBe('AAPL');
  });

  it('handles Yahoo Finance errors gracefully', async () => {
    const { redis } = require('@/lib/redis');
    redis.get.mockResolvedValue(null);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    const req = new NextRequest('http://localhost:3000/api/search?q=apple');
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain('unavailable');
    expect(data.results).toEqual([]);
  });

  it('limits results to 10', async () => {
    const { redis } = require('@/lib/redis');
    redis.get.mockResolvedValue(null);

    const yahooResponse = {
      quotes: Array.from({ length: 20 }, (_, i) => ({
        symbol: `SYM${i}`,
        shortname: `Company ${i}`,
        quoteType: 'EQUITY',
        exchDisp: 'NASDAQ'
      }))
    };

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => yahooResponse
    });

    const req = new NextRequest('http://localhost:3000/api/search?q=test');
    const response = await GET(req);
    const data = await response.json();

    expect(data.results).toHaveLength(10);
  });
});
