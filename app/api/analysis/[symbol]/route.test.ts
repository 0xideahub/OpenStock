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
      buildRequest('AAPL', { investorType: 'value' }, 'secret'),
      buildContext('AAPL'),
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'Analysis for investor type "value" is not available yet.',
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
    });

    const response = await POST(
      buildRequest(
        'AAPL',
        {
          investorType: 'growth',
          companyName: 'Apple Inc.',
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
      },
    });
  });

  it('handles generateAnalysis errors gracefully', async () => {
    const { POST } = await import('./route');
    generateAnalysisMock.mockRejectedValue(new Error('OpenAI failure'));

    const response = await POST(
      buildRequest('TSLA', { investorType: 'growth' }, 'secret'),
      buildContext('TSLA'),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to generate analysis',
    });
  });
});
