/**
 * Valuation Service
 * Implements buy/pass/hold logic for different investor types
 * Based on value investing principles from Peter Lynch, Benjamin Graham, and Joel Greenblatt
 *
 * This is the server-side implementation that mirrors the client logic.
 */

export type InvestorType = 'growth' | 'value';
export type Recommendation = 'buy' | 'hold' | 'pass';

export interface ValuationResult {
  recommendation: Recommendation;
  score: number; // 0-100 score
  reasons: string[];
  warnings: string[];
}

interface Metrics {
  pe?: number;
  pb?: number;
  roe?: number;
  roeActual?: number | null;
  growth?: number;
  debtToEquity?: number;
  revenueCagr3Y?: number | null;
  earningsCagr3Y?: number | null;
  dividendYield?: number | null;
  payoutRatio?: number | null;
  freeCashflowPayoutRatio?: number | null;
  currentRatio?: number | null;
  quickRatio?: number | null;
}

/**
 * Evaluate a stock based on investor type and fundamental metrics
 */
export function evaluateStock(
  metrics: Metrics,
  investorType: InvestorType,
): ValuationResult {
  switch (investorType) {
    case 'growth':
      return evaluateGrowthStock(metrics);
    case 'value':
      return evaluateValueStock(metrics);
    default:
      throw new Error(`Unknown investor type: ${investorType}`);
  }
}

/**
 * Growth Investing Strategy
 * Focus on: High growth rates, reasonable P/E, strong ROE
 * Peter Lynch style: Look for companies growing earnings faster than their P/E ratio
 */
function evaluateGrowthStock(metrics: Metrics): ValuationResult {
  const {
    pe = 999,
    pb = 999,
    roe = 0,
    growth = 0,
    debtToEquity = 999,
  } = metrics;

  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 50; // Start at neutral

  // Peter Lynch's PEG Ratio: P/E divided by growth rate
  // PEG < 1 is excellent, PEG < 2 is good
  const peg = growth > 0 ? pe / growth : 999;

  // 1. Growth Rate (most important for growth investors)
  if (growth > 20) {
    score += 20;
    reasons.push(`Strong growth rate of ${growth.toFixed(1)}%`);
  } else if (growth > 10) {
    score += 10;
    reasons.push(`Solid growth rate of ${growth.toFixed(1)}%`);
  } else if (growth < 0) {
    score -= 10;
    warnings.push(`Negative growth rate of ${growth.toFixed(1)}%`);
  } else if (growth < 5) {
    score -= 5;
    warnings.push(`Low growth rate of ${growth.toFixed(1)}%`);
  }

  // 2. PEG Ratio (Peter Lynch's favorite metric)
  if (peg < 1 && peg > 0) {
    score += 25;
    reasons.push(`Excellent PEG ratio of ${peg.toFixed(2)}`);
  } else if (peg < 2 && peg > 0) {
    score += 15;
    reasons.push(`Good PEG ratio of ${peg.toFixed(2)}`);
  } else if (peg > 3) {
    score -= 10;
    warnings.push(`High PEG ratio of ${peg.toFixed(2)} suggests overvaluation`);
  }

  // 3. Return on Equity (indicates quality of business)
  if (roe > 20) {
    score += 15;
    reasons.push(`Strong ROE of ${roe.toFixed(1)}%`);
  } else if (roe > 15) {
    score += 10;
    reasons.push(`Healthy ROE of ${roe.toFixed(1)}%`);
  } else if (roe < 10) {
    score -= 10;
    warnings.push(`Low ROE of ${roe.toFixed(1)}%`);
  }

  // 4. Debt Level (growth stocks should have manageable debt)
  if (debtToEquity < 0.5) {
    score += 10;
    reasons.push(`Low debt-to-equity of ${debtToEquity.toFixed(2)}`);
  } else if (debtToEquity > 5) {
    score -= 10;
    warnings.push(`Very high debt-to-equity of ${debtToEquity.toFixed(2)}`);
  } else if (debtToEquity > 2) {
    score -= 5;
    warnings.push(`Elevated debt-to-equity of ${debtToEquity.toFixed(2)}`);
  }

  // 5. Price-to-Book (sanity check for growth)
  if (pb < 3) {
    score += 5;
  } else if (pb > 10) {
    score -= 5;
    warnings.push(`Very high P/B ratio of ${pb.toFixed(2)}`);
  }

  return determineRecommendation(score, reasons, warnings);
}

/**
 * Value Investing Strategy
 * Focus on: Low P/E, low P/B, positive ROE, reasonable debt
 * Benjamin Graham & Joel Greenblatt style
 */
function evaluateValueStock(metrics: Metrics): ValuationResult {
  const {
    pe = 999,
    pb = 999,
    roe = 0,
    growth = 0,
    debtToEquity = 999,
  } = metrics;

  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 50; // Start at neutral

  // 1. P/E Ratio (lower is better for value)
  if (pe > 0 && pe < 12) {
    score += 25;
    reasons.push(`Low P/E ratio of ${pe.toFixed(2)}`);
  } else if (pe > 0 && pe < 18) {
    score += 15;
    reasons.push(`Reasonable P/E ratio of ${pe.toFixed(2)}`);
  } else if (pe > 25) {
    score -= 15;
    warnings.push(`High P/E ratio of ${pe.toFixed(2)}`);
  } else if (pe <= 0) {
    score -= 20;
    warnings.push('Company has negative earnings');
  }

  // 2. P/B Ratio (Benjamin Graham liked P/B < 1.5)
  if (pb > 0 && pb < 1) {
    score += 25;
    reasons.push(
      `Excellent P/B ratio of ${pb.toFixed(2)} (trading below book value)`,
    );
  } else if (pb > 0 && pb < 1.5) {
    score += 20;
    reasons.push(`Strong P/B ratio of ${pb.toFixed(2)}`);
  } else if (pb > 0 && pb < 3) {
    score += 10;
    reasons.push(`Reasonable P/B ratio of ${pb.toFixed(2)}`);
  } else if (pb > 5) {
    score -= 10;
    warnings.push(`High P/B ratio of ${pb.toFixed(2)}`);
  }

  // 3. Return on Equity (value stocks should still be profitable)
  if (roe > 15) {
    score += 20;
    reasons.push(`Strong ROE of ${roe.toFixed(1)}%`);
  } else if (roe > 10) {
    score += 10;
    reasons.push(`Solid ROE of ${roe.toFixed(1)}%`);
  } else if (roe < 5) {
    score -= 10;
    warnings.push(`Low ROE of ${roe.toFixed(1)}%`);
  }

  // 4. Growth (value stocks can have modest growth)
  if (growth > 10) {
    score += 15;
    reasons.push(`Good growth rate of ${growth.toFixed(1)}% for a value stock`);
  } else if (growth > 0) {
    score += 5;
  } else if (growth < -10) {
    score -= 10;
    warnings.push(`Negative growth of ${growth.toFixed(1)}%`);
  } else if (growth < 0) {
    score -= 5;
    warnings.push(`Slight revenue decline of ${growth.toFixed(1)}%`);
  }

  // 5. Debt-to-Equity (value stocks should have low debt)
  if (debtToEquity < 0.5) {
    score += 15;
    reasons.push(`Low debt-to-equity of ${debtToEquity.toFixed(2)}`);
  } else if (debtToEquity < 1) {
    score += 5;
  } else if (debtToEquity > 5) {
    score -= 15;
    warnings.push(`Very high debt-to-equity of ${debtToEquity.toFixed(2)}`);
  } else if (debtToEquity > 2) {
    score -= 8;
    warnings.push(`Elevated debt-to-equity of ${debtToEquity.toFixed(2)}`);
  }

  return determineRecommendation(score, reasons, warnings);
}

/**
 * Convert score to buy/hold/pass recommendation
 */
function determineRecommendation(
  score: number,
  reasons: string[],
  warnings: string[],
): ValuationResult {
  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));

  let recommendation: Recommendation;
  if (score >= 60) {
    recommendation = 'buy';
  } else if (score >= 40) {
    recommendation = 'hold';
  } else {
    recommendation = 'pass';
  }

  return {
    recommendation,
    score,
    reasons,
    warnings,
  };
}
