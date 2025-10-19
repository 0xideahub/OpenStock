import { FetchTimeoutError, fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getCached, setCached } from '../cache';
import { GROWTH_ANALYST_PROMPT } from './prompts';

type InvestorType = 'growth' | 'value' | 'income';

type Recommendation = 'buy' | 'hold' | 'pass';

export interface AnalysisPayload {
  symbol: string;
  companyName?: string;
  investorType: InvestorType;
  recommendation: Recommendation;
  metrics: {
    pe?: number;
    pb?: number;
    roe?: number;
    growth?: number;
    debtToEquity?: number;
    revenueCagr3Y?: number | null;
    earningsCagr3Y?: number | null;
  };
  reasons: string[];
  warnings: string[];
}

export interface AnalysisResult {
  symbol: string;
  investorType: InvestorType;
  analysis: string;
  cached: boolean;
  source: 'openai' | 'fallback';
  fetchedAt: string;
  model?: string;
  recommendation?: Recommendation;
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 15000;
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

const formatNumber = (value?: number | null, suffix = ''): string | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return `${value.toFixed(suffix === '%' ? 1 : 2)}${suffix}`;
};

const buildGrowthUserPrompt = (payload: AnalysisPayload): string => {
  const { symbol, companyName, metrics, reasons, warnings } = payload;
  const lines: string[] = [];

  lines.push(`Ticker: ${symbol}`);
  if (companyName) {
    lines.push(`Company: ${companyName}`);
  }

  const metricEntries = [
    ['P/E', formatNumber(metrics.pe)],
    ['P/B', formatNumber(metrics.pb)],
    ['ROE', formatNumber(metrics.roe, '%')],
    ['Growth Rate', formatNumber(metrics.growth, '%')],
    ['Revenue CAGR (3Y)', formatNumber(metrics.revenueCagr3Y, '%')],
    ['Earnings CAGR (3Y)', formatNumber(metrics.earningsCagr3Y, '%')],
    ['Debt-to-Equity', formatNumber(metrics.debtToEquity)],
  ].filter(([, value]) => value !== undefined) as Array<[string, string]>;

  if (metricEntries.length > 0) {
    lines.push('Key Metrics:');
    metricEntries.forEach(([label, value]) => {
      lines.push(`- ${label}: ${value}`);
    });
  }

  if (reasons.length > 0) {
    lines.push('Bullish Factors:');
    reasons.slice(0, 3).forEach((reason) => lines.push(`- ${reason}`));
  }

  if (warnings.length > 0) {
    lines.push('Risks / Watchouts:');
    warnings.slice(0, 3).forEach((warning) => lines.push(`- ${warning}`));
  }

  lines.push(
    'Using only the information provided, craft the analysis per the system instructions. Avoid inventing data and never hedge on the recommendation.'
  );

  return lines.join('\n');
};

const buildGrowthFallbackAnalysis = (
  payload: AnalysisPayload,
  failureReason?: string,
): string => {
  const {
    symbol,
    companyName,
    metrics,
    reasons,
    warnings,
    recommendation,
  } = payload;

  const name = companyName || symbol;
  const growthRate =
    formatNumber(metrics.revenueCagr3Y, '%') ??
    formatNumber(metrics.growth, '%');
  const roe = formatNumber(metrics.roe, '%');
  const peg =
    metrics.pe && metrics.growth && metrics.growth > 0
      ? (metrics.pe / metrics.growth).toFixed(2)
      : undefined;
  const debtToEquity = formatNumber(metrics.debtToEquity);

  const summaryParts: string[] = [];
  if (growthRate) summaryParts.push(`growth at ${growthRate}`);
  if (roe) summaryParts.push(`ROE ${roe}`);
  if (peg) summaryParts.push(`PEG ${peg}`);
  if (debtToEquity) summaryParts.push(`debt/equity ${debtToEquity}`);

  const summary =
    summaryParts.length > 0
      ? `${name} growth profile: ${summaryParts.join(', ')}.`
      : `${name} growth profile: review the key metrics above.`;

  const bulletLines: string[] = [];
  reasons.slice(0, 2).forEach((reason) => bulletLines.push(`• ${reason}`));
  warnings.slice(0, 2).forEach((warning) => bulletLines.push(`• ⚠ ${warning}`));

  if (bulletLines.length === 0) {
    if (growthRate) bulletLines.push(`• Growth rate trending at ${growthRate}`);
    if (roe) bulletLines.push(`• ROE sits near ${roe}`);
  }

  const recReason =
    reasons[0] ??
    (warnings[0] ? `Monitor ${warnings[0].toLowerCase()}` : 'Assess catalysts against current valuation.');
  const recommendationLine = `Recommendation: ${recommendation.toUpperCase()} — ${recReason}`;
  const fallbackLine = failureReason
    ? `*(Fallback reason: ${failureReason})*`
    : undefined;

  return [summary, ...bulletLines, recommendationLine, fallbackLine]
    .filter(Boolean)
    .join('\n')
    .trim();
};

const getPromptForInvestorType = (investorType: InvestorType) => {
  switch (investorType) {
    case 'growth':
      return GROWTH_ANALYST_PROMPT;
    default:
      throw new Error(`Unsupported investor type for analysis: ${investorType}`);
  }
};

const buildCacheKey = (payload: AnalysisPayload) =>
  `analysis:${payload.investorType}:${payload.symbol.toUpperCase()}`;

export async function generateAnalysis(
  payload: AnalysisPayload
): Promise<AnalysisResult> {
  const cacheKey = buildCacheKey(payload);
  const cached = await getCached<AnalysisResult>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      symbol: payload.symbol.toUpperCase(),
      investorType: payload.investorType,
      analysis: buildGrowthFallbackAnalysis(payload, 'OpenAI API key not configured'),
      cached: false,
      source: 'fallback',
      fetchedAt: new Date().toISOString(),
      recommendation: payload.recommendation,
    };
  }

  const systemPrompt = getPromptForInvestorType(payload.investorType);
  const userPrompt = buildGrowthUserPrompt(payload);

  try {
    const response = await fetchWithTimeout(
      OPENAI_API_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEFAULT_OPENAI_MODEL,
          temperature: 0.3,
          max_tokens: 450,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      },
      REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `OpenAI request failed (${response.status} ${response.statusText}) ${errorText}`.trim()
      );
    }

    const data = await response.json();
    const content =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.text?.trim() ||
      buildGrowthFallbackAnalysis(payload, 'OpenAI response empty');

    const result: AnalysisResult = {
      symbol: payload.symbol.toUpperCase(),
      investorType: payload.investorType,
      analysis: content,
      cached: false,
      source: 'openai',
      fetchedAt: new Date().toISOString(),
      model: data?.model,
      recommendation: payload.recommendation,
    };

    await setCached(cacheKey, result, CACHE_TTL_SECONDS);

    return result;
  } catch (error) {
    const reason =
      error instanceof FetchTimeoutError
        ? 'OpenAI request timed out'
        : error instanceof Error
          ? error.message
          : 'Unknown OpenAI error';

    console.error('[ai] Failed to generate analysis:', reason);

    return {
      symbol: payload.symbol.toUpperCase(),
      investorType: payload.investorType,
      analysis: buildGrowthFallbackAnalysis(payload, reason),
      cached: false,
      source: 'fallback',
      fetchedAt: new Date().toISOString(),
      recommendation: payload.recommendation,
    };
  }
}
