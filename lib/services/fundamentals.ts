import { fetchYahooFundamentals } from '../yahoo/fundamentals';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

type DataSource = 'tiingo' | 'yahoo';

export interface NormalizedFundamentals {
  symbol: string;
  companyName?: string;
  currency?: string;
  exchange?: string;
  source: DataSource;
  fetchedAt: string;
  metrics: FundamentalMetrics;
  warnings?: string[];
}

export interface FundamentalMetrics {
  currentPrice?: number;
  change?: number;
  changePercent?: number;
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
}

const TIINGO_API_KEY = process.env.TIINGO_API_KEY;
const TIINGO_BASE_URL = 'https://api.tiingo.com';

interface TiingoPriceEntry {
  close?: number;
  adjClose?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  date?: string;
}

interface TiingoFundamentalEntry {
  date?: string;
  peRatio?: number;
  pbRatio?: number;
  trailingPEG1Y?: number;
  marketCap?: number;
  enterpriseVal?: number;
  dividendsPerShare?: number;
  currentRatio?: number;
  quickRatio?: number;
  totalDebt?: number;
  totalAssets?: number;
  totalRevenue?: number;
  netIncome?: number;
  freeCashFlow?: number;
  operatingCashFlow?: number;
  grossMargin?: number;
  profitMargin?: number;
  returnOnAssets?: number;
}

interface TiingoMetadata {
  ticker?: string;
  name?: string;
  exchangeCode?: string;
  description?: string;
  startDate?: string;
}

const toNumber = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const safeDivide = (numerator: number, denominator: number) => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return undefined;
  }
  return numerator / denominator;
};

const fetchTiingoJSON = async <T>(path: string): Promise<T> => {
  if (!TIINGO_API_KEY) {
    throw new Error('Tiingo API key is not configured');
  }

  const url = `${TIINGO_BASE_URL}${path}${path.includes('?') ? '&' : '?'}token=${TIINGO_API_KEY}`;
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
    10000, // 10 second timeout for Tiingo API
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Tiingo request failed (${response.status} ${response.statusText}) ${detail}`.trim(),
    );
  }

  return (await response.json()) as T;
};

const fetchTiingoMetadata = async (symbol: string): Promise<TiingoMetadata> => {
  return fetchTiingoJSON<TiingoMetadata>(`/tiingo/daily/${encodeURIComponent(symbol)}`);
};

const fetchTiingoPriceHistory = async (symbol: string): Promise<TiingoPriceEntry[]> => {
  return fetchTiingoJSON<TiingoPriceEntry[]>(
    `/tiingo/daily/${encodeURIComponent(symbol)}/prices`,
  );
};

const fetchTiingoFundamentals = async (
  symbol: string,
): Promise<TiingoFundamentalEntry[]> => {
  return fetchTiingoJSON<TiingoFundamentalEntry[]>(
    `/tiingo/fundamentals/${encodeURIComponent(symbol)}/daily`,
  );
};

const deriveTiingoMetrics = ({
  price,
  fundamentals,
}: {
  price?: TiingoPriceEntry;
  fundamentals?: TiingoFundamentalEntry;
}): FundamentalMetrics => {
  const currentPrice = toNumber(price?.close);
  const previousAdjusted = toNumber(price?.adjClose);
  const change =
    currentPrice !== undefined && previousAdjusted !== undefined
      ? currentPrice - previousAdjusted
      : undefined;
  const changePercent =
    change !== undefined && previousAdjusted
      ? (change / previousAdjusted) * 100
      : undefined;

  const roe =
    fundamentals?.pbRatio && fundamentals?.peRatio && fundamentals.peRatio > 0
      ? Math.max(0, Math.min((fundamentals.pbRatio / fundamentals.peRatio) * 100, 100))
      : undefined;

  const growth =
    fundamentals?.peRatio && fundamentals?.trailingPEG1Y
      ? Math.max(
          -50,
          Math.min(fundamentals.peRatio / Math.abs(fundamentals.trailingPEG1Y), 100),
        )
      : undefined;

  const debtToEquity =
    fundamentals?.marketCap &&
    fundamentals.enterpriseVal &&
    fundamentals.enterpriseVal > fundamentals.marketCap
      ? Math.max(
          0,
          Math.min(
            (fundamentals.enterpriseVal - fundamentals.marketCap) / fundamentals.marketCap,
            5,
          ),
        )
      : undefined;

  const returnOnAssets = toNumber(fundamentals?.returnOnAssets);
  const profitMargins =
    toNumber(fundamentals?.profitMargin) ??
    (fundamentals?.netIncome && fundamentals?.totalRevenue
      ? safeDivide(fundamentals.netIncome, fundamentals.totalRevenue)
      : undefined);
  const grossMargins =
    toNumber(fundamentals?.grossMargin) ??
    ((fundamentals?.totalRevenue && fundamentals?.netIncome
      ? safeDivide(fundamentals.netIncome, fundamentals.totalRevenue)
      : undefined) ?? undefined);

  return {
    currentPrice,
    change,
    changePercent,
    trailingPE: toNumber(fundamentals?.peRatio),
    priceToBook: toNumber(fundamentals?.pbRatio),
    marketCap: toNumber(fundamentals?.marketCap),
    dividendYield: fundamentals?.dividendsPerShare
      ? safeDivide(fundamentals.dividendsPerShare, currentPrice ?? 0)
      : undefined,
    currentRatio: toNumber(fundamentals?.currentRatio),
    quickRatio: toNumber(fundamentals?.quickRatio),
    totalDebt: toNumber(fundamentals?.totalDebt),
    totalCash: undefined,
    totalRevenue: toNumber(fundamentals?.totalRevenue),
    freeCashflow: toNumber(fundamentals?.freeCashFlow),
    operatingCashflow: toNumber(fundamentals?.operatingCashFlow),
    profitMargins,
    grossMargins,
    returnOnAssets,
    returnOnEquity: roe,
    revenueGrowth: growth,
    debtToEquity,
  };
};

const buildTiingoResult = (
  symbol: string,
  metadata: TiingoMetadata,
  priceHistory: TiingoPriceEntry[],
  fundamentalsList: TiingoFundamentalEntry[],
): NormalizedFundamentals => {
  const priceEntry = priceHistory.at(-1);
  const fundamentalEntry = fundamentalsList.at(-1);

  if (!priceEntry || !fundamentalEntry) {
    throw new Error('Tiingo fundamentals data incomplete');
  }

  const metrics = deriveTiingoMetrics({
    price: priceEntry,
    fundamentals: fundamentalEntry,
  });

  const warnings: string[] = [];
  if (!metrics.trailingPE) warnings.push('Missing Tiingo P/E ratio');
  if (!metrics.priceToBook) warnings.push('Missing Tiingo P/B ratio');

  return {
    symbol,
    companyName: metadata.name ?? symbol,
    currency: 'USD',
    exchange: metadata.exchangeCode,
    source: 'tiingo',
    fetchedAt: new Date().toISOString(),
    metrics,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
};

const mergeSupplementalMetrics = (
  primary: NormalizedFundamentals,
  supplemental: NormalizedFundamentals,
): NormalizedFundamentals => {
  const merged: FundamentalMetrics = { ...primary.metrics };

  const keysToSupplement: Array<keyof FundamentalMetrics> = [
    'dividendYield',
    'payoutRatio',
    'forwardPE',
    'earningsGrowth',
    'roeActual',
    'revenueCagr3Y',
    'earningsCagr3Y',
    'debtToEquityActual',
    'freeCashflowPayoutRatio',
    'revenueGrowthHistory',
    'earningsGrowthHistory',
  ];

  for (const key of keysToSupplement) {
    const currentValue = merged[key];
    const supplementalValue = supplemental.metrics[key];
    if (
      (currentValue === undefined || currentValue === null || currentValue === 0) &&
      supplementalValue !== undefined &&
      supplementalValue !== null
    ) {
      merged[key] = supplementalValue;
    }
  }

  const warnings = [
    ...(primary.warnings ?? []),
    ...(supplemental.warnings ?? []),
  ];

  return {
    ...primary,
    metrics: merged,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
};

const fetchFromTiingo = async (symbol: string): Promise<NormalizedFundamentals> => {
  if (!TIINGO_API_KEY) {
    throw new Error('Tiingo API key is not configured');
  }

  const [metadata, priceHistory, fundamentals] = await Promise.all([
    fetchTiingoMetadata(symbol),
    fetchTiingoPriceHistory(symbol),
    fetchTiingoFundamentals(symbol),
  ]);

  if (!Array.isArray(priceHistory) || priceHistory.length === 0) {
    throw new Error('Tiingo price history is empty');
  }

  if (!Array.isArray(fundamentals) || fundamentals.length === 0) {
    throw new Error('Tiingo fundamentals history is empty');
  }

  return buildTiingoResult(symbol, metadata, priceHistory, fundamentals);
};

const normalizeYahooResult = (
  yahoo: Awaited<ReturnType<typeof fetchYahooFundamentals>>,
): NormalizedFundamentals => ({
  symbol: yahoo.symbol,
  companyName: yahoo.companyName,
  currency: yahoo.currency,
  exchange: yahoo.exchangeName,
  source: 'yahoo',
  fetchedAt: yahoo.fetchedAt,
  metrics: {
    currentPrice: yahoo.metrics.currentPrice,
    change: yahoo.metrics.change,
    changePercent: yahoo.metrics.changePercent,
    trailingPE: yahoo.metrics.trailingPE,
    forwardPE: yahoo.metrics.forwardPE,
    payoutRatio: yahoo.metrics.payoutRatio,
    profitMargins: yahoo.metrics.profitMargins,
    revenueGrowth: yahoo.metrics.revenueGrowth,
    grossMargins: yahoo.metrics.grossMargins,
    freeCashflow: yahoo.metrics.freeCashflow,
    operatingCashflow: yahoo.metrics.operatingCashflow,
    totalRevenue: yahoo.metrics.totalRevenue,
    totalDebt: yahoo.metrics.totalDebt,
    totalCash: yahoo.metrics.totalCash,
    currentRatio: yahoo.metrics.currentRatio,
    quickRatio: yahoo.metrics.quickRatio,
    marketCap: yahoo.metrics.marketCap,
    priceToBook: yahoo.metrics.priceToBook,
    dividendYield: yahoo.metrics.dividendYield,
    debtToEquity: yahoo.metrics.debtToEquity,
    returnOnEquity: yahoo.metrics.returnOnEquity,
    returnOnAssets: yahoo.metrics.returnOnAssets,
    earningsGrowth: yahoo.metrics.earningsGrowth,
    roeActual: yahoo.metrics.roeActual,
    revenueCagr3Y: yahoo.metrics.revenueCagr3Y,
    earningsCagr3Y: yahoo.metrics.earningsCagr3Y,
    debtToEquityActual: yahoo.metrics.debtToEquityActual,
    freeCashflowPayoutRatio: yahoo.metrics.freeCashflowPayoutRatio,
    revenueGrowthHistory: yahoo.metrics.revenueGrowthHistory,
    earningsGrowthHistory: yahoo.metrics.earningsGrowthHistory,
  },
});

export interface FetchFundamentalsOptions {
  forceRefresh?: boolean;
}

export async function fetchFundamentalsWithFallback(
  symbol: string,
  options?: FetchFundamentalsOptions,
): Promise<NormalizedFundamentals> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) {
    throw new Error('Ticker symbol is required');
  }

  const errors: unknown[] = [];

  try {
    const tiingoResult = await fetchFromTiingo(normalizedSymbol);

    const needsSupplement =
      tiingoResult.metrics.dividendYield === undefined ||
      tiingoResult.metrics.dividendYield === null ||
      tiingoResult.metrics.dividendYield === 0 ||
      tiingoResult.metrics.payoutRatio === undefined ||
      tiingoResult.metrics.payoutRatio === null;

    if (!needsSupplement) {
      return tiingoResult;
    }

    try {
      const yahooSupplement = await fetchYahooFundamentals(normalizedSymbol, options);
      const normalizedYahoo = normalizeYahooResult(yahooSupplement);
      const merged = mergeSupplementalMetrics(tiingoResult, normalizedYahoo);
      merged.source = tiingoResult.source;
      return merged;
    } catch (supplementError) {
      const message =
        supplementError instanceof Error ? supplementError.message : String(supplementError);
      console.warn(
        `[fundamentals] Unable to supplement Tiingo data for ${normalizedSymbol}: ${message}`,
      );
      return tiingoResult;
    }
  } catch (error) {
    errors.push(error);
    const message =
      error instanceof Error ? error.message : JSON.stringify(error, null, 2);
    console.warn(`[fundamentals] Tiingo fetch failed for ${normalizedSymbol}: ${message}`);
  }

  try {
    const yahooResult = await fetchYahooFundamentals(normalizedSymbol, options);
    return normalizeYahooResult(yahooResult);
  } catch (error) {
    errors.push(error);
    const message =
      error instanceof Error ? error.message : JSON.stringify(error, null, 2);
    console.error(
      `[fundamentals] Yahoo fallback failed for ${normalizedSymbol}: ${message}`,
    );
    if (errors.length === 1) {
      throw error;
    }
    const aggregate = new AggregateError(
      errors as Error[],
      `Failed to fetch fundamentals for ${normalizedSymbol}`,
    );
    throw aggregate;
  }
}
