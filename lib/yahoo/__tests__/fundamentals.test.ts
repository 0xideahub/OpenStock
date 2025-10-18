import { describe, it, expect } from 'vitest';

import { __testables } from '../fundamentals';

const { computeStatementDerivedMetrics } = __testables;

describe('Yahoo statement-derived metrics', () => {
  it('computes ROE, CAGR, payout ratios from statement data', () => {
    const result = {
      incomeStatementHistory: {
        incomeStatementHistory: [
          {
            endDate: { raw: 1704067200 },
            totalRevenue: { raw: 1000 },
            netIncome: { raw: 120 },
          },
          {
            endDate: { raw: 1672444800 },
            totalRevenue: { raw: 900 },
            netIncome: { raw: 100 },
          },
          {
            endDate: { raw: 1640908800 },
            totalRevenue: { raw: 820 },
            netIncome: { raw: 90 },
          },
          {
            endDate: { raw: 1609372800 },
            totalRevenue: { raw: 700 },
            netIncome: { raw: 80 },
          },
        ],
      },
      balanceSheetHistory: {
        balanceSheetStatements: [
          {
            endDate: { raw: 1704067200 },
            totalStockholderEquity: { raw: 600 },
            totalLiab: { raw: 300 },
          },
          {
            endDate: { raw: 1672444800 },
            totalStockholderEquity: { raw: 550 },
            totalLiab: { raw: 320 },
          },
        ],
      },
      cashflowStatementHistory: {
        cashflowStatements: [
          {
            endDate: { raw: 1704067200 },
            freeCashFlow: { raw: 150 },
            dividendsPaid: { raw: -60 },
          },
        ],
      },
    } as Record<string, any>;

    const metrics = computeStatementDerivedMetrics(result);

    expect(metrics.roeActual).toBeDefined();
    expect(metrics.roeActual ?? 0).toBeCloseTo(0.2087, 3);
    expect(metrics.revenueCagr3Y).toBeDefined();
    expect(metrics.revenueCagr3Y ?? 0).toBeGreaterThan(0);
    expect(metrics.earningsCagr3Y ?? 0).toBeGreaterThan(0);
    expect(metrics.debtToEquityActual).toBeCloseTo(0.5, 2);
    expect(metrics.freeCashflowPayoutRatio).toBeCloseTo(0.4, 2);
    expect(metrics.revenueGrowthHistory?.length).toBeGreaterThan(0);
    expect(metrics.earningsGrowthHistory?.length).toBeGreaterThan(0);
  });

  it('returns undefined metrics when statements are missing', () => {
    const metrics = computeStatementDerivedMetrics({});
    expect(metrics.roeActual).toBeUndefined();
    expect(metrics.revenueCagr3Y).toBeUndefined();
    expect(metrics.freeCashflowPayoutRatio).toBeUndefined();
  });
});
