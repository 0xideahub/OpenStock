import { getYahooSession, invalidateYahooSession } from './session';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getCached, setCached, isCacheEnabled } from '../cache';

const YAHOO_QUOTE_SUMMARY_BASE =
  'https://query2.finance.yahoo.com/v10/finance/quoteSummary/';
const FUNDAMENTALS_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const FUNDAMENTALS_TTL_SECONDS = Math.floor(FUNDAMENTALS_TTL_MS / 1000); // 43200 seconds
const FUNDAMENTALS_CACHE_KEY_PREFIX = 'fundamentals:yahoo:v2:';
const REQUESTED_MODULES = [
  'financialData',
  'defaultKeyStatistics',
  'summaryDetail',
  'price',
  'assetProfile',
  'incomeStatementHistory',
  'incomeStatementHistoryQuarterly',
  'balanceSheetHistory',
  'cashflowStatementHistory',
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
  roeActual?: number;
  revenueCagr3Y?: number;
  earningsCagr3Y?: number;
  debtToEquityActual?: number;
  freeCashflowPayoutRatio?: number;
  revenueGrowthHistory?: Array<{ period: string; value: number }>;
  earningsGrowthHistory?: Array<{ period: string; value: number }>;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}

export interface YahooFundamentals {
  symbol: string;
  companyName?: string;
  description?: string;
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

// In-memory cache as fallback when Redis is not available
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

type StatementEntry = {
  endDate?: number;
  periodLabel?: string;
  totalRevenue?: number;
  netIncome?: number;
  dividendsPaid?: number;
  freeCashFlow?: number;
  totalStockholderEquity?: number;
  totalLiabilities?: number;
};

const toPeriodLabel = (timestamp?: number): string | undefined => {
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const extractStatementEntries = (
  rawEntries: any[] | undefined,
  pick: (entry: any) => Partial<StatementEntry>,
): StatementEntry[] => {
  if (!Array.isArray(rawEntries)) {
    return [];
  }
  return rawEntries
    .map((entry) => {
      const endDate = numberFrom(entry?.endDate?.raw ?? entry?.endDate);
      return {
        endDate,
        periodLabel: toPeriodLabel(endDate),
        ...pick(entry),
      };
    })
    .filter((entry) => entry.endDate !== undefined)
    .sort((a, b) => (b.endDate ?? 0) - (a.endDate ?? 0));
};

const cagr = (latest: number, oldest: number, years: number): number | undefined => {
  if (!Number.isFinite(latest) || !Number.isFinite(oldest) || latest <= 0 || oldest <= 0) {
    return undefined;
  }
  const span = Math.max(1, years);
  return Math.pow(latest / oldest, 1 / span) - 1;
};

const selectOlderEntry = (entries: StatementEntry[], periods: number): StatementEntry | undefined => {
  if (entries.length <= 1) {
    return undefined;
  }
  const index = Math.min(entries.length - 1, periods);
  return entries[index];
};

const computeStatementDerivedMetrics = (
  result: Record<string, any>,
): Partial<YahooFundamentalsMetrics> => {
  const incomeHistory = extractStatementEntries(
    result.incomeStatementHistory?.incomeStatementHistory,
    (entry) => ({
      totalRevenue: numberFrom(entry?.totalRevenue),
      netIncome: numberFrom(entry?.netIncome),
    }),
  );

  const balanceHistory = extractStatementEntries(
    result.balanceSheetHistory?.balanceSheetStatements,
    (entry) => ({
      totalStockholderEquity: numberFrom(entry?.totalStockholderEquity),
      totalLiabilities: numberFrom(entry?.totalLiab ?? entry?.totalLiabilities),
    }),
  );

  const cashflowHistory = extractStatementEntries(
    result.cashflowStatementHistory?.cashflowStatements,
    (entry) => ({
      freeCashFlow: numberFrom(entry?.freeCashFlow),
      dividendsPaid: numberFrom(entry?.dividendsPaid),
    }),
  );

  const latestIncome = incomeHistory[0];
  const olderIncome = selectOlderEntry(incomeHistory, 3);
  const revenueCagr = latestIncome && olderIncome
    ? cagr(
        latestIncome.totalRevenue ?? NaN,
        olderIncome.totalRevenue ?? NaN,
        Math.max(1, (latestIncome.endDate ?? 0) - (olderIncome.endDate ?? 0)) / (365 * 24 * 60 * 60),
      )
    : undefined;

  const earningsCagr = latestIncome && olderIncome
    ? cagr(
        Math.abs(latestIncome.netIncome ?? NaN),
        Math.abs(olderIncome.netIncome ?? NaN),
        Math.max(1, (latestIncome.endDate ?? 0) - (olderIncome.endDate ?? 0)) / (365 * 24 * 60 * 60),
      )
    : undefined;

  const latestBalance = balanceHistory[0];
  const previousBalance = balanceHistory[1];
  const averageEquity =
    latestBalance?.totalStockholderEquity && previousBalance?.totalStockholderEquity
      ? (latestBalance.totalStockholderEquity + previousBalance.totalStockholderEquity) / 2
      : latestBalance?.totalStockholderEquity;

  const roeActual =
    latestIncome?.netIncome && Number.isFinite(averageEquity) && averageEquity && averageEquity !== 0
      ? latestIncome.netIncome / averageEquity
      : undefined;

  const debtToEquityActual =
    latestBalance?.totalLiabilities && latestBalance?.totalStockholderEquity
      ? latestBalance.totalLiabilities / latestBalance.totalStockholderEquity
      : undefined;

  const latestCashflow = cashflowHistory[0];
  const freeCashflowPayoutRatio =
    latestCashflow?.freeCashFlow && latestCashflow.freeCashFlow > 0 && latestCashflow?.dividendsPaid
      ? Math.abs(latestCashflow.dividendsPaid) / latestCashflow.freeCashFlow
      : undefined;

  const revenueGrowthHistory =
    incomeHistory.length >= 2
      ? incomeHistory.slice(0, 4).map((entry, index, arr) => {
          const next = arr[index + 1];
          if (!next?.totalRevenue || !entry.totalRevenue || entry.totalRevenue <= 0) {
            return {
              period: entry.periodLabel ?? `period-${index}`,
              value: NaN,
            };
          }
          const growth = next ? entry.totalRevenue / next.totalRevenue - 1 : NaN;
          return {
            period: entry.periodLabel ?? `period-${index}`,
            value: growth,
          };
        })
      : undefined;

  const earningsGrowthHistory =
    incomeHistory.length >= 2
      ? incomeHistory.slice(0, 4).map((entry, index, arr) => {
          const next = arr[index + 1];
          if (!next?.netIncome || !entry.netIncome || entry.netIncome === 0) {
            return {
              period: entry.periodLabel ?? `period-${index}`,
              value: NaN,
            };
          }
          const growth = next ? entry.netIncome / next.netIncome - 1 : NaN;
          return {
            period: entry.periodLabel ?? `period-${index}`,
            value: growth,
          };
        })
      : undefined;

  return {
    roeActual,
    revenueCagr3Y: revenueCagr,
    earningsCagr3Y: earningsCagr,
    debtToEquityActual,
    freeCashflowPayoutRatio,
    revenueGrowthHistory:
      revenueGrowthHistory?.filter((entry) => Number.isFinite(entry.value)) ?? undefined,
    earningsGrowthHistory:
      earningsGrowthHistory?.filter((entry) => Number.isFinite(entry.value)) ?? undefined,
  };
};

export const __testables = {
  extractStatementEntries,
  computeStatementDerivedMetrics,
};

const buildQuoteSummaryUrl = (symbol: string, crumb: string): string => {
  // Yahoo Finance uses hyphens for class shares (e.g., BRK-B instead of BRK.B)
  const yahooSymbol = symbol.replace(/\./g, '-');
  const url = new URL(`${YAHOO_QUOTE_SUMMARY_BASE}${encodeURIComponent(yahooSymbol)}`);
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
  const assetProfile = result.assetProfile ?? {};
  const statementMetrics = computeStatementDerivedMetrics(result);

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
      ? change / previousClose
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
    roeActual: statementMetrics.roeActual,
    revenueCagr3Y: statementMetrics.revenueCagr3Y,
    earningsCagr3Y: statementMetrics.earningsCagr3Y,
    debtToEquityActual: statementMetrics.debtToEquityActual,
    freeCashflowPayoutRatio: statementMetrics.freeCashflowPayoutRatio,
    revenueGrowthHistory: statementMetrics.revenueGrowthHistory,
    earningsGrowthHistory: statementMetrics.earningsGrowthHistory,
    fiftyTwoWeekHigh: numberFrom(summaryDetail.fiftyTwoWeekHigh ?? keyStatistics.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: numberFrom(summaryDetail.fiftyTwoWeekLow ?? keyStatistics.fiftyTwoWeekLow),
  };

  return {
    symbol:
      (price.symbol as string | undefined)?.toUpperCase() ??
      requestedSymbol.toUpperCase(),
    companyName:
      (price.longName as string | undefined) ??
      (price.shortName as string | undefined),
    description:
      typeof assetProfile.longBusinessSummary === 'string'
        ? assetProfile.longBusinessSummary
        : undefined,
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
  const cacheKey = `${FUNDAMENTALS_CACHE_KEY_PREFIX}${normalizedSymbol}`;

  // Try Redis cache first (if enabled)
  if (!forceRefresh && isCacheEnabled()) {
    const cachedFromRedis = await getCached<YahooFundamentals>(cacheKey);
    if (cachedFromRedis) {
      console.info(`[yahoo-fundamentals] Retrieved ${normalizedSymbol} from Redis cache`);
      return cachedFromRedis;
    }
  }

  // Fall back to in-memory cache if Redis is not available
  const now = Date.now();
  const cached = fundamentalsCache.get(normalizedSymbol);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    console.info(`[yahoo-fundamentals] Retrieved ${normalizedSymbol} from in-memory cache`);
    return cached.data;
  }

  try {
    const result = await performQuoteSummaryRequest(normalizedSymbol, forceRefresh);

    // Store in Redis (if enabled)
    if (isCacheEnabled()) {
      await setCached(cacheKey, result, FUNDAMENTALS_TTL_SECONDS);
      console.info(`[yahoo-fundamentals] Stored ${normalizedSymbol} in Redis cache`);
    }

    // Also store in memory as fallback
    fundamentalsCache.set(normalizedSymbol, {
      data: result,
      expiresAt: now + FUNDAMENTALS_TTL_MS,
    });

    return result;
  } catch (error) {
    if (error instanceof InvalidYahooSessionError && !forceRefresh) {
      await invalidateYahooSession();
      const retryResult = await performQuoteSummaryRequest(normalizedSymbol, true);

      // Store retry result in both caches
      if (isCacheEnabled()) {
        await setCached(cacheKey, retryResult, FUNDAMENTALS_TTL_SECONDS);
      }
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
