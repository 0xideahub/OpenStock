import { FetchTimeoutError, fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getCached, setCached } from '../cache';
import {
  GROWTH_ANALYST_PROMPT,
  VALUE_ANALYST_PROMPT,
} from './prompts';

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
    roeActual?: number | null;
    growth?: number;
    revenueCagr3Y?: number | null;
    earningsCagr3Y?: number | null;
    debtToEquity?: number;
    dividendYield?: number | null;
    payoutRatio?: number | null;
    freeCashflowPayoutRatio?: number | null;
    currentRatio?: number | null;
    quickRatio?: number | null;
  };
  reasons: string[];
  warnings: string[];
  isPremium?: boolean;
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

const formatNumber = (value?: number | null, suffix = '', digits = 2): string | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const precision = suffix === '%' ? 1 : digits;
  return `${value.toFixed(precision)}${suffix}`;
};

const formatPercentFromRatio = (value?: number | null, digits = 1): string | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return `${(value * 100).toFixed(digits)}%`;
};

const sanitizeAnalysisText = (text: string): string => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^recommendation\s*:/i.test(line));
  return lines.join('\n');
};

const appendMetricLines = (
  lines: string[],
  header: string,
  entries: Array<[string, string | undefined]>,
) => {
  const filtered = entries.filter(([, value]) => value !== undefined) as Array<[string, string]>;
  if (filtered.length === 0) {
    return;
  }
  lines.push(`${header}:`);
  filtered.forEach(([label, value]) => lines.push(`- ${label}: ${value}`));
};

const buildUserPrompt = (payload: AnalysisPayload): string => {
  const { symbol, companyName, investorType, recommendation, metrics, reasons, warnings } = payload;
  const lines: string[] = [];

  lines.push(`Ticker: ${symbol}`);
  if (companyName) {
    lines.push(`Company: ${companyName}`);
  }
  lines.push(`Valuation signal: ${recommendation.toUpperCase()}`);

  switch (investorType) {
    case 'growth': {
      appendMetricLines(lines, 'Growth metrics', [
        ['P/E', formatNumber(metrics.pe)],
        ['P/B', formatNumber(metrics.pb)],
        ['ROE', formatNumber(metrics.roe ?? metrics.roeActual ?? undefined, '%')],
        ['Revenue growth rate', formatNumber(metrics.growth, '%')],
        ['Revenue CAGR (3Y)', formatNumber(metrics.revenueCagr3Y, '%')],
        ['Earnings CAGR (3Y)', formatNumber(metrics.earningsCagr3Y, '%')],
        ['Debt-to-Equity', formatNumber(metrics.debtToEquity)],
      ]);
      break;
    }
    case 'value': {
      appendMetricLines(lines, 'Valuation metrics', [
        ['P/E', formatNumber(metrics.pe)],
        ['P/B', formatNumber(metrics.pb)],
        ['ROE', formatNumber(metrics.roe ?? metrics.roeActual ?? undefined, '%')],
        ['Revenue CAGR (3Y)', formatNumber(metrics.revenueCagr3Y, '%')],
        ['Earnings CAGR (3Y)', formatNumber(metrics.earningsCagr3Y, '%')],
        ['Debt-to-Equity', formatNumber(metrics.debtToEquity)],
        ['Current ratio', formatNumber(metrics.currentRatio, '', 2)],
        ['Quick ratio', formatNumber(metrics.quickRatio, '', 2)],
      ]);
      break;
    }
    case 'income': {
      appendMetricLines(lines, 'Income metrics', [
        ['Dividend yield', formatPercentFromRatio(metrics.dividendYield)],
        ['Payout ratio', formatPercentFromRatio(metrics.payoutRatio)],
        ['FCF payout ratio', formatPercentFromRatio(metrics.freeCashflowPayoutRatio)],
        ['Revenue CAGR (3Y)', formatNumber(metrics.revenueCagr3Y, '%')],
        ['Earnings CAGR (3Y)', formatNumber(metrics.earningsCagr3Y, '%')],
        ['Debt-to-Equity', formatNumber(metrics.debtToEquity)],
      ]);
      break;
    }
  }

  if (reasons.length > 0) {
    lines.push('Key positives:');
    reasons.slice(0, 3).forEach((reasonLine) => lines.push(`- ${reasonLine}`));
  }

  if (warnings.length > 0) {
    lines.push('Risks to monitor:');
    warnings.slice(0, 3).forEach((warningLine) => lines.push(`- ${warningLine}`));
  }

  lines.push(
    'Using only the information provided, craft the analysis per the system instructions. Avoid inventing data and do not restate the recommendation line.',
  );

  return lines.join('\n');
};

const buildGrowthFallbackAnalysis = (
  payload: AnalysisPayload,
  failureReason?: string,
): string => {
  const { symbol, companyName, metrics, reasons, warnings, recommendation } = payload;
  const name = companyName || symbol;
  const growthRate =
    formatNumber(metrics.revenueCagr3Y, '%') ??
    formatNumber(metrics.growth, '%');
  const roe = formatNumber(metrics.roe ?? metrics.roeActual ?? undefined, '%');
  const peg =
    metrics.pe && metrics.growth && metrics.growth > 0
      ? (metrics.pe / metrics.growth).toFixed(2)
      : undefined;
  const debtToEquity = formatNumber(metrics.debtToEquity);

  const outlookPhrase =
    recommendation === 'buy'
      ? 'favors a BUY signal'
      : recommendation === 'hold'
        ? 'suggests HOLD and monitor'
        : 'leans toward PASS for now';

  const summaryParts: string[] = [`Outlook ${outlookPhrase}`];
  if (growthRate) summaryParts.push(`growth at ${growthRate}`);
  if (roe) summaryParts.push(`ROE ${roe}`);
  if (peg) summaryParts.push(`PEG ${peg}`);
  if (debtToEquity) summaryParts.push(`debt/equity ${debtToEquity}`);

  const summary =
    summaryParts.length > 0
      ? `${name} growth profile: ${summaryParts.join(', ')}.`
      : `${name} growth profile: review the key metrics above.`;

  const bulletLines: string[] = [];
  reasons.slice(0, 2).forEach((reasonLine) => bulletLines.push(`• ${reasonLine}`));
  warnings.slice(0, 2).forEach((warningLine) => bulletLines.push(`• ⚠ ${warningLine}`));

  if (bulletLines.length === 0) {
    if (growthRate) bulletLines.push(`• Growth rate trending at ${growthRate}`);
    if (roe) bulletLines.push(`• ROE sits near ${roe}`);
  }

  const fallbackLine = failureReason ? `*(Fallback reason: ${failureReason})*` : undefined;

  return [summary, ...bulletLines, fallbackLine]
    .filter(Boolean)
    .join('\n')
    .trim();
};

const buildValueFallbackAnalysis = (
  payload: AnalysisPayload,
  failureReason?: string,
): string => {
  const { symbol, companyName, metrics, reasons, warnings, recommendation } = payload;
  const name = companyName || symbol;
  const pe = formatNumber(metrics.pe);
  const pb = formatNumber(metrics.pb);
  const roe = formatNumber(metrics.roe ?? metrics.roeActual ?? undefined, '%');
  const debtToEquity = formatNumber(metrics.debtToEquity);
  const revenueCagr = formatNumber(metrics.revenueCagr3Y, '%');

  const outlookPhrase =
    recommendation === 'buy'
      ? 'looks undervalued against fundamentals'
      : recommendation === 'hold'
        ? 'appears fairly priced pending catalysts'
        : 'offers limited margin of safety at current levels';

  const summaryParts: string[] = [`Outlook ${outlookPhrase}`];
  if (pe) summaryParts.push(`P/E ${pe}`);
  if (pb) summaryParts.push(`P/B ${pb}`);
  if (roe) summaryParts.push(`ROE ${roe}`);
  if (debtToEquity) summaryParts.push(`debt/equity ${debtToEquity}`);
  if (revenueCagr) summaryParts.push(`revenue CAGR ${revenueCagr}`);

  const summary =
    summaryParts.length > 0
      ? `${name} value profile: ${summaryParts.join(', ')}.`
      : `${name} value profile: review the balance sheet and valuation metrics above.`;

  const bulletLines: string[] = [];
  reasons.slice(0, 2).forEach((line) => bulletLines.push(`• ${line}`));
  warnings.slice(0, 2).forEach((line) => bulletLines.push(`• ⚠ ${line}`));

  if (bulletLines.length === 0) {
    if (pe) bulletLines.push(`• Valuation currently at P/E ${pe}`);
    if (debtToEquity) bulletLines.push(`• Leverage runs at ${debtToEquity} debt/equity`);
  }

  const fallbackLine = failureReason ? `*(Fallback reason: ${failureReason})*` : undefined;

  return [summary, ...bulletLines, fallbackLine]
    .filter(Boolean)
    .join('\n')
    .trim();
};

const buildIncomeFallbackAnalysis = (
  payload: AnalysisPayload,
  failureReason?: string,
): string => {
  const { symbol, companyName, metrics, reasons, warnings, recommendation } = payload;
  const name = companyName || symbol;
  const dividendYield = formatPercentFromRatio(metrics.dividendYield);
  const payoutRatio = formatPercentFromRatio(metrics.payoutRatio);
  const fcfPayout = formatPercentFromRatio(metrics.freeCashflowPayoutRatio);
  const debtToEquity = formatNumber(metrics.debtToEquity);
  const earningsCagr = formatNumber(metrics.earningsCagr3Y, '%');

  const outlookPhrase =
    recommendation === 'buy'
      ? 'supports a BUY for dependable income'
      : recommendation === 'hold'
        ? 'suggests HOLD while monitoring payout coverage'
        : 'leans toward PASS until coverage metrics improve';

  const summaryParts: string[] = [`Outlook ${outlookPhrase}`];
  if (dividendYield) summaryParts.push(`yield ${dividendYield}`);
  if (payoutRatio) summaryParts.push(`payout ${payoutRatio}`);
  if (fcfPayout) summaryParts.push(`FCF payout ${fcfPayout}`);
  if (debtToEquity) summaryParts.push(`debt/equity ${debtToEquity}`);
  if (earningsCagr) summaryParts.push(`earnings CAGR ${earningsCagr}`);

  const summary =
    summaryParts.length > 0
      ? `${name} income profile: ${summaryParts.join(', ')}.`
      : `${name} income profile: review dividend coverage metrics above.`;

  const bulletLines: string[] = [];
  reasons.slice(0, 2).forEach((line) => bulletLines.push(`• ${line}`));
  warnings.slice(0, 2).forEach((line) => bulletLines.push(`• ⚠ ${line}`));

  if (bulletLines.length === 0) {
    if (dividendYield) bulletLines.push(`• Dividend yield currently ${dividendYield}`);
    if (payoutRatio) bulletLines.push(`• Earnings payout ratio around ${payoutRatio}`);
  }

  const fallbackLine = failureReason ? `*(Fallback reason: ${failureReason})*` : undefined;

  return [summary, ...bulletLines, fallbackLine]
    .filter(Boolean)
    .join('\n')
    .trim();
};

const buildFallbackAnalysis = (payload: AnalysisPayload, failureReason?: string): string => {
  const raw = (() => {
    switch (payload.investorType) {
      case 'growth':
        return buildGrowthFallbackAnalysis(payload, failureReason);
      case 'value':
        return buildValueFallbackAnalysis(payload, failureReason);
      case 'income':
        return buildIncomeFallbackAnalysis(payload, failureReason);
      default:
        return 'Analysis temporarily unavailable. Review the fundamentals above for key insights.';
    }
  })();

  return sanitizeAnalysisText(raw);
};

const getPromptForInvestorType = (investorType: InvestorType) => {
  switch (investorType) {
    case 'growth':
      return GROWTH_ANALYST_PROMPT;
    case 'value':
      return VALUE_ANALYST_PROMPT;
    case 'income':
      return VALUE_ANALYST_PROMPT;
    default:
      throw new Error(`Unsupported investor type for analysis: ${investorType}`);
  }
};

const buildCacheKey = (payload: AnalysisPayload) => {
  const tier = payload.isPremium ? 'premium' : 'free';
  return `analysis:v3:${tier}:${payload.investorType}:${payload.symbol.toUpperCase()}`; // v3: Added premium tier support
};

export async function generateAnalysis(
  payload: AnalysisPayload,
): Promise<AnalysisResult> {
  const cacheKey = buildCacheKey(payload);
  const cached = await getCached<AnalysisResult>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const analysis = buildFallbackAnalysis(payload, 'OpenAI API key not configured');
    return {
      symbol: payload.symbol.toUpperCase(),
      investorType: payload.investorType,
      analysis,
      cached: false,
      source: 'fallback',
      fetchedAt: new Date().toISOString(),
      recommendation: payload.recommendation,
    };
  }

  const systemPrompt = getPromptForInvestorType(payload.investorType);
  const userPrompt = buildUserPrompt(payload);

  // Premium users get full detailed analysis, free users get truncated version
  const maxTokens = payload.isPremium ? 1200 : 450;

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
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      },
      REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `OpenAI request failed (${response.status} ${response.statusText}) ${errorText}`.trim(),
      );
    }

    const data = await response.json();
    const rawContent =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.text?.trim() ||
      buildFallbackAnalysis(payload, 'OpenAI response empty');
    const content = sanitizeAnalysisText(rawContent);

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

    const analysis = buildFallbackAnalysis(payload, reason);

    return {
      symbol: payload.symbol.toUpperCase(),
      investorType: payload.investorType,
      analysis,
      cached: false,
      source: 'fallback',
      fetchedAt: new Date().toISOString(),
      recommendation: payload.recommendation,
    };
  }
}
