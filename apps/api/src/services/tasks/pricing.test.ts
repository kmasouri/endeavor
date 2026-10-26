import { calculateCostUsd, formatDollars, startOfMonth } from './pricing';

describe('pricing', () => {
  const prices = { 'small-model': { inputPerMillion: 0.5, outputPerMillion: 2 } };

  it('turns token usage into dollars', () => {
    expect(
      calculateCostUsd(prices, 'small-model', { inputTokens: 1_000_000, outputTokens: 500_000 })
    ).toBe(1.5);
  });

  it('says the cost is unknown for a model with no price', () => {
    expect(calculateCostUsd(prices, 'other', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it('formats dollars and finds the start of the month', () => {
    expect(formatDollars(0.4)).toBe('$0.40');
    expect(startOfMonth(new Date('2026-10-23T09:00:00Z'))).toEqual(
      new Date('2026-10-01T00:00:00Z')
    );
  });
});
