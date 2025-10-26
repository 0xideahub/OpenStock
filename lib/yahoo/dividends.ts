import { getYahooSession } from './session';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

export interface YahooDividendPayment {
  date: string;
  amount: number;
  exDate?: string;
  payDate?: string;
}

export interface YahooDividendHistory {
  symbol: string;
  data: YahooDividendPayment[];
  fetchedAt: string;
}

export class YahooDividendNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YahooDividendNotFoundError';
  }
}

/**
 * Fetch dividend history from Yahoo Finance using the chart API events feed.
 * Defaults to the last two years to align with the previous Tiingo implementation.
 */
export async function fetchYahooDividendHistory(
  symbol: string,
  range: string = '2y'
): Promise<YahooDividendHistory> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!normalizedSymbol) {
    throw new Error('Symbol is required');
  }

  // Yahoo Finance uses hyphens for class shares (e.g., BRK-B instead of BRK.B)
  const yahooSymbol = normalizedSymbol.replace(/\./g, '-');

  const session = await getYahooSession();
  const url = `${YAHOO_CHART_BASE}${encodeURIComponent(
    yahooSymbol
  )}?range=${encodeURIComponent(range)}&interval=1d&events=div`;

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
    if (response.status === 404) {
      throw new YahooDividendNotFoundError(`Yahoo Finance could not find dividends for ${normalizedSymbol}`);
    }
    throw new Error(`Yahoo dividend API returned ${response.status}`);
  }

  const result = await response.json();

  if (result.chart?.error) {
    const { code, description } = result.chart.error;
    if (
      code === 'Not Found' ||
      code === 'NoDataFound' ||
      code === 'No data found'
    ) {
      throw new YahooDividendNotFoundError(description || `No dividend data for ${normalizedSymbol}`);
    }
    throw new Error(description || 'Yahoo chart API error');
  }

  const chartResult = result.chart?.result?.[0];

  if (!chartResult) {
    throw new Error('No chart data in Yahoo dividend response');
  }

  const dividendEvents = chartResult.events?.dividends;

  if (!dividendEvents || Object.keys(dividendEvents).length === 0) {
    return {
      symbol: normalizedSymbol,
      data: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const payments = Object.values(dividendEvents)
    .map((entry: any) => {
      const timestamp =
        typeof entry?.date === 'number' ? entry.date : typeof entry?.timestamp === 'number' ? entry.timestamp : undefined;
      const amount = typeof entry?.amount === 'number' ? entry.amount : undefined;

      if (!timestamp || !Number.isFinite(timestamp) || amount === undefined || Number.isNaN(amount)) {
        return null;
      }

      const isoDate = new Date(timestamp * 1000).toISOString().split('T')[0];
      const formattedDate =
        typeof entry?.formattedDate === 'string' && entry.formattedDate.trim().length > 0
          ? entry.formattedDate
          : isoDate;

      return {
        date: isoDate,
        amount,
        exDate: isoDate,
        payDate: formattedDate,
      };
    })
    .filter((entry): entry is YahooDividendPayment => entry !== null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    symbol: normalizedSymbol,
    data: payments,
    fetchedAt: new Date().toISOString(),
  };
}
