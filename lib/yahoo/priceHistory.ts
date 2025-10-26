import { getYahooSession } from './session';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

export interface YahooPriceHistoryEntry {
  date: string;
  close: number;
  volume?: number;
}

export interface YahooPriceHistory {
  symbol: string;
  data: YahooPriceHistoryEntry[];
  period: string;
  fetchedAt: string;
}

/**
 * Fetch price history from Yahoo Finance
 * @param symbol Stock ticker symbol
 * @param period Time period ('6m', '1y', '3y', '5y')
 */
export async function fetchYahooPriceHistory(
  symbol: string,
  period: string = '6m'
): Promise<YahooPriceHistory> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  // Yahoo Finance uses hyphens for class shares (e.g., BRK-B instead of BRK.B)
  const yahooSymbol = normalizedSymbol.replace(/\./g, '-');

  // Calculate date range
  const endDate = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
  const startDate = calculateStartDate(endDate, period);

  const session = await getYahooSession();
  const url = `${YAHOO_CHART_BASE}${encodeURIComponent(yahooSymbol)}?period1=${startDate}&period2=${endDate}&interval=1d`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Cookie: session.cookie,
        },
      },
      10000 // 10 second timeout
    );

    if (!response.ok) {
      throw new Error(`Yahoo chart API returned ${response.status}`);
    }

    const result = await response.json();

    if (result.chart?.error) {
      throw new Error(result.chart.error.description || 'Yahoo chart API error');
    }

    const chartResult = result.chart?.result?.[0];
    if (!chartResult) {
      throw new Error('No chart data in Yahoo response');
    }

    const timestamps = chartResult.timestamp || [];
    const quotes = chartResult.indicators?.quote?.[0] || {};
    const closes = quotes.close || [];
    const volumes = quotes.volume || [];

    if (timestamps.length === 0 || closes.length === 0) {
      throw new Error('No price data available from Yahoo');
    }

    // Transform to our format
    const data: YahooPriceHistoryEntry[] = timestamps.map((ts: number, i: number) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      close: closes[i],
      volume: volumes[i] || undefined,
    })).filter((entry: YahooPriceHistoryEntry) =>
      entry.close !== null && entry.close !== undefined && !isNaN(entry.close)
    );

    return {
      symbol: normalizedSymbol, // Return original symbol format (with dot)
      data,
      period,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[yahoo-price-history] Failed to fetch for ${normalizedSymbol} (Yahoo: ${yahooSymbol}):`, error);
    throw error;
  }
}

function calculateStartDate(endTimestamp: number, period: string): number {
  const end = new Date(endTimestamp * 1000);
  const start = new Date(end);

  switch (period) {
    case '1y':
      start.setFullYear(end.getFullYear() - 1);
      break;
    case '3y':
      start.setFullYear(end.getFullYear() - 3);
      break;
    case '5y':
      start.setFullYear(end.getFullYear() - 5);
      break;
    case '6m':
    default:
      start.setMonth(end.getMonth() - 6);
      break;
  }

  return Math.floor(start.getTime() / 1000);
}
