import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGINAL_ENV = { ...process.env };
const generateAnalysisMock = vi.fn();

vi.mock('@/lib/ai/generateAnalysis', () => ({
  generateAnalysis: generateAnalysisMock,
}));

const buildContext = (symbol: string) => ({
  params: Promise.resolve({ symbol }),
});

const buildRequest = (symbol: string, body: unknown, apiKey?: string) =>
  new NextRequest(`http://test.local/api/analysis/${symbol}`, {
    method: 'POST',
    headers: apiKey
      ? new Headers({
          'x-api-key': apiKey,
          'content-type': 'application/json',
        })
      : new Headers({
          'content-type': 'application/json',
        }),
    body: JSON.stringify(body),
  });

describe('POST /api/analysis/[symbol]', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.INTERNAL_API_KEY = 'secret';
    generateAnalysisMock.mockReset();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns 401 for missing API key', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://test.local/api/analysis/AAPL', {
        method: 'POST',
        body: JSON.stringify({ investorType: 'growth' }),
        headers: new Headers({ 'content-type': 'application/json' }),
      }),
      buildContext('AAPL'),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('rejects unsupported investor type', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      buildRequest('AAPL', { investorType: 'balanced' }, 'secret'),
      buildContext('AAPL'),
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'Analysis for investor type "balanced" is not available yet.',
    });
    expect(generateAnalysisMock).not.toHaveBeenCalled();
  });

  it('returns analysis for growth investor type', async () => {
    const { POST } = await import('./route');
    const now = new Date().toISOString();

    generateAnalysisMock.mockResolvedValue({
      symbol: 'AAPL',
      investorType: 'growth',
      analysis: 'Sample analysis',
      cached: false,
      source: 'openai',
      fetchedAt: now,
      model: 'gpt-4o-mini',
      recommendation: 'buy',
    });

    const response = await POST(
      buildRequest(
        'AAPL',
        {
          investorType: 'growth',
          companyName: 'Apple Inc.',
          recommendation: 'buy',
          metrics: { pe: 25, growth: 18 },
          reasons: ['Strong growth'],
          warnings: [],
        },
        'secret',
      ),
      buildContext('AAPL'),
    );

    expect(generateAnalysisMock).toHaveBeenCalledWith({
      symbol: 'AAPL',
      investorType: 'growth',
      companyName: 'Apple Inc.',
      recommendation: 'buy',
      metrics: { pe: 25, growth: 18 },
      reasons: ['Strong growth'],
      warnings: [],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        symbol: 'AAPL',
        investorType: 'growth',
        analysis: 'Sample analysis',
        cached: false,
        source: 'openai',
        fetchedAt: now,
        model: 'gpt-4o-mini',
        recommendation: 'buy',
      },
    });
  });

  it('returns analysis for value investor type', async () => {
    const { POST } = await import('./route');
    const now = new Date().toISOString();

    generateAnalysisMock.mockResolvedValue({
      symbol: 'BRK.B',
      investorType: 'value',
      analysis: 'Value analysis',
      cached: false,
      source: 'openai',
      fetchedAt: now,
      model: 'gpt-4o-mini',
      recommendation: 'hold',
    });

    const response = await POST(
      buildRequest(
        'BRK.B',
        {
          investorType: 'value',
          companyName: 'Berkshire Hathaway',
          recommendation: 'hold',
          metrics: { pe: 14, pb: 1.2, roe: 18, debtToEquity: 0.3 },
          reasons: ['Solid balance sheet'],
          warnings: ['Watch valuation premium'],
        },
        'secret',
      ),
      buildContext('BRK.B'),
    );

    expect(generateAnalysisMock).toHaveBeenCalledWith({
      symbol: 'BRK.B',
      investorType: 'value',
      companyName: 'Berkshire Hathaway',
      recommendation: 'hold',
      metrics: { pe: 14, pb: 1.2, roe: 18, debtToEquity: 0.3 },
      reasons: ['Solid balance sheet'],
      warnings: ['Watch valuation premium'],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        symbol: 'BRK.B',
        investorType: 'value',
        analysis: 'Value analysis',
        cached: false,
        source: 'openai',
        fetchedAt: now,
        model: 'gpt-4o-mini',
        recommendation: 'hold',
      },
    });
  });

  it('returns analysis for income investor type', async () => {
    const { POST } = await import('./route');
    const now = new Date().toISOString();

    generateAnalysisMock.mockResolvedValue({
      symbol: 'T',
      investorType: 'income',
      analysis: 'Income analysis',
      cached: false,
      source: 'openai',
      fetchedAt: now,
      model: 'gpt-4o-mini',
      recommendation: 'buy',
    });

    const response = await POST(
      buildRequest(
        'T',
        {
          investorType: 'income',
          companyName: 'AT&T Inc.',
          recommendation: 'buy',
          metrics: { dividendYield: 0.065, payoutRatio: 0.55, debtToEquity: 1.1 },
          reasons: ['Attractive yield with improving coverage'],
          warnings: ['Monitor leverage profile'],
        },
        'secret',
      ),
      buildContext('T'),
    );

    expect(generateAnalysisMock).toHaveBeenCalledWith({
      symbol: 'T',
      investorType: 'income',
      companyName: 'AT&T Inc.',
      recommendation: 'buy',
      metrics: { dividendYield: 0.065, payoutRatio: 0.55, debtToEquity: 1.1 },
      reasons: ['Attractive yield with improving coverage'],
      warnings: ['Monitor leverage profile'],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        symbol: 'T',
        investorType: 'income',
        analysis: 'Income analysis',
        cached: false,
        source: 'openai',
        fetchedAt: now,
        model: 'gpt-4o-mini',
        recommendation: 'buy',
      },
    });
  });

  it('handles generateAnalysis errors gracefully', async () => {
    const { POST } = await import('./route');
    generateAnalysisMock.mockRejectedValue(new Error('OpenAI failure'));

    const response = await POST(
      buildRequest('TSLA', { investorType: 'growth', recommendation: 'hold' }, 'secret'),
      buildContext('TSLA'),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to generate analysis',
    });
  });

  it('requires recommendation field', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      buildRequest('MSFT', { investorType: 'growth' }, 'secret'),
      buildContext('MSFT'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'recommendation must be one of "buy", "hold", or "pass"',
    });
    expect(generateAnalysisMock).not.toHaveBeenCalled();
  });
});
