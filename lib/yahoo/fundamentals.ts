import { getYahooSession, invalidateYahooSession } from './session';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

const YAHOO_QUOTE_SUMMARY_BASE =
  'https://query2.finance.yahoo.com/v10/finance/quoteSummary/';
const FUNDAMENTALS_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const REQUESTED_MODULES = [
  'financialData',
  'defaultKeyStatistics',
  'summaryDetail',
  'price',
] as const;

type QuoteSummaryModules = (typeof REQUESTED_MODULES)[number];

type QuoteSummaryResponse = {
  quoteSummary?: {
    result?: Array<Record<QuoteSummaryModules, Record<string, any>>>;
    error?: {
      code?: string;
      description?: string;
    } | null;
  } | null;
};

export interface YahooFundamentalsMetrics {
  currentPrice?: number;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  marketState?: string;
  trailingPE?: number;
  forwardPE?: number;
  payoutRatio?: number;
  profitMargins?: number;
  revenueGrowth?: number;
  grossMargins?: number;
  freeCashflow?: number;
  operatingCashflow?: number;
  totalRevenue?: number;
  totalDebt?: number;
  totalCash?: number;
  currentRatio?: number;
  quickRatio?: number;
  marketCap?: number;
  priceToBook?: number;
  dividendYield?: number;
  debtToEquity?: number;
  returnOnEquity?: number;
  returnOnAssets?: number;
  earningsGrowth?: number;
}

export interface YahooFundamentals {
  symbol: string;
  companyName?: string;
  currency?: string;
  exchangeName?: string;
  source: 'yahoo';
  fetchedAt: string;
  metrics: YahooFundamentalsMetrics;
}

type CacheEntry = {
  data: YahooFundamentals;
  expiresAt: number;
};

const fundamentalsCache = new Map<string, CacheEntry>();

class InvalidYahooSessionError extends Error {
  constructor(message?: string) {
    super(message ?? 'Yahoo session is invalid');
    this.name = 'InvalidYahooSessionError';
  }
}

const numberFrom = (value: any): number | undefined => {
  if (value == null) {
    return undefined;
  }

  if (typeof value === 'object' && 'raw' in value) {
    return numberFrom((value as { raw?: any }).raw);
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const percentFrom = (value: any): number | undefined => {
  const num = numberFrom(value);
  if (num === undefined) {
    return undefined;
  }
  return num;
};

const buildQuoteSummaryUrl = (symbol: string, crumb: string): string => {
  const url = new URL(`${YAHOO_QUOTE_SUMMARY_BASE}${encodeURIComponent(symbol)}`);
  url.searchParams.set('modules', REQUESTED_MODULES.join(','));
  url.searchParams.set('crumb', crumb);
  return url.toString();
};

const parseQuoteSummary = (
  payload: QuoteSummaryResponse,
  requestedSymbol: string,
): YahooFundamentals => {
  const result = payload.quoteSummary?.result?.[0];

  if (!result) {
    throw new Error('Yahoo quote summary result missing');
  }

  const price = result.price ?? {};
  const financialData = result.financialData ?? {};
  const summaryDetail = result.summaryDetail ?? {};
  const keyStatistics = result.defaultKeyStatistics ?? {};

  const currentPrice =
    numberFrom(price.regularMarketPrice) ??
    numberFrom(financialData.currentPrice);

  const previousClose =
    numberFrom(price.regularMarketPreviousClose) ??
    numberFrom(summaryDetail.previousClose);

  const change =
    numberFrom(price.regularMarketChange) ??
    (currentPrice !== undefined && previousClose !== undefined
      ? currentPrice - previousClose
      : undefined);

  const changePercent =
    percentFrom(price.regularMarketChangePercent) ??
    (change !== undefined && previousClose
      ? (change / previousClose) * 100
      : undefined);

  const metrics: YahooFundamentalsMetrics = {
    currentPrice,
    previousClose,
    change,
    changePercent,
    marketState: typeof price.marketState === 'string' ? price.marketState : undefined,
    trailingPE:
      numberFrom(summaryDetail.trailingPE) ?? numberFrom(keyStatistics.trailingPE),
    forwardPE:
      numberFrom(summaryDetail.forwardPE) ??
      numberFrom(financialData.forwardPE) ??
      numberFrom(keyStatistics.forwardPE),
    payoutRatio:
      percentFrom(summaryDetail.payoutRatio) ??
      percentFrom(financialData.payoutRatio),
    profitMargins: percentFrom(financialData.profitMargins),
    revenueGrowth: percentFrom(financialData.revenueGrowth),
    grossMargins: percentFrom(financialData.grossMargins),
    freeCashflow: numberFrom(financialData.freeCashflow),
    operatingCashflow: numberFrom(financialData.operatingCashflow),
    totalRevenue: numberFrom(financialData.totalRevenue),
    totalDebt:
      numberFrom(financialData.totalDebt) ?? numberFrom(keyStatistics.totalDebt),
    totalCash: numberFrom(financialData.totalCash),
    currentRatio: numberFrom(financialData.currentRatio),
    quickRatio: numberFrom(financialData.quickRatio),
    marketCap:
      numberFrom(price.marketCap) ?? numberFrom(keyStatistics.marketCap),
    priceToBook:
      numberFrom(summaryDetail.priceToBook) ??
      numberFrom(financialData.priceToBook) ??
      numberFrom(keyStatistics.priceToBook),
    dividendYield: percentFrom(summaryDetail.dividendYield),
    debtToEquity: numberFrom(financialData.debtToEquity),
    returnOnEquity: percentFrom(financialData.returnOnEquity),
    returnOnAssets: percentFrom(financialData.returnOnAssets),
    earningsGrowth: percentFrom(financialData.earningsGrowth),
  };

  return {
    symbol:
      (price.symbol as string | undefined)?.toUpperCase() ??
      requestedSymbol.toUpperCase(),
    companyName:
      (price.longName as string | undefined) ??
      (price.shortName as string | undefined),
    currency: typeof price.currency === 'string' ? price.currency : undefined,
    exchangeName:
      (price.exchangeName as string | undefined) ??
      (price.fullExchangeName as string | undefined),
    source: 'yahoo',
    fetchedAt: new Date().toISOString(),
    metrics,
  };
};

const shouldRetryWithNewSession = (status: number, bodyText: string): boolean => {
  if (status === 401 || status === 403) {
    return true;
  }
  try {
    const payload = JSON.parse(bodyText) as QuoteSummaryResponse;
    const description = payload.quoteSummary?.error?.description ?? '';
    return /invalid (crumb|cookie)/i.test(description);
  } catch {
    return false;
  }
};

const performQuoteSummaryRequest = async (
  symbol: string,
  forceRefreshSession: boolean,
): Promise<YahooFundamentals> => {
  const session = await getYahooSession({ forceRefresh: forceRefreshSession });

  const response = await fetchWithTimeout(
    buildQuoteSummaryUrl(symbol, session.crumb),
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        Referer: 'https://finance.yahoo.com/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        Connection: 'keep-alive',
        Cookie: session.cookieHeader,
      },
    },
    15000, // 15 second timeout for Yahoo quote summary
  );

  const bodyText = await response.text();

  if (!response.ok) {
    if (shouldRetryWithNewSession(response.status, bodyText)) {
      throw new InvalidYahooSessionError(
        `Yahoo session rejected with status ${response.status}`,
      );
    }
    throw new Error(
      `Yahoo fundamentals request failed (${response.status} ${response.statusText})`,
    );
  }

  let parsed: QuoteSummaryResponse;
  try {
    parsed = JSON.parse(bodyText) as QuoteSummaryResponse;
  } catch (error) {
    throw new Error('Yahoo fundamentals response was not valid JSON');
  }

  const crumbErrorDescription = parsed.quoteSummary?.error?.description;
  if (crumbErrorDescription && /invalid (crumb|cookie)/i.test(crumbErrorDescription)) {
    throw new InvalidYahooSessionError(crumbErrorDescription);
  }

  return parseQuoteSummary(parsed, symbol);
};

export async function fetchYahooFundamentals(
  symbol: string,
  options?: { forceRefresh?: boolean },
): Promise<YahooFundamentals> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!normalizedSymbol) {
    throw new Error('Ticker symbol is required');
  }

  const forceRefresh = options?.forceRefresh ?? false;

  const now = Date.now();
  const cached = fundamentalsCache.get(normalizedSymbol);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.data;
  }

  try {
    const result = await performQuoteSummaryRequest(normalizedSymbol, forceRefresh);
    fundamentalsCache.set(normalizedSymbol, {
      data: result,
      expiresAt: now + FUNDAMENTALS_TTL_MS,
    });
    return result;
  } catch (error) {
    if (error instanceof InvalidYahooSessionError && !forceRefresh) {
      invalidateYahooSession();
      const retryResult = await performQuoteSummaryRequest(normalizedSymbol, true);
      fundamentalsCache.set(normalizedSymbol, {
        data: retryResult,
        expiresAt: Date.now() + FUNDAMENTALS_TTL_MS,
      });
      return retryResult;
    }
    throw error;
  }
}

export function clearYahooFundamentalsCache(): void {
  fundamentalsCache.clear();
}
