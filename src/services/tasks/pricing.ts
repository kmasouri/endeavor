// What one model costs, in US dollars per million tokens. Prices come from MODEL_PRICES, so
// they can be kept up to date without a code change. A model with no price has an unknown cost.
export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export type PriceTable = Record<string, ModelPrice>;

export function costUsd(
  prices: PriceTable,
  model: string,
  usage: { inputTokens: number; outputTokens: number }
): number | null {
  const price = prices[model];
  if (!price) {
    return null;
  }
  return (
    (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) /
    1_000_000
  );
}

export function dollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// The first moment of the current month in UTC, for monthly budgets.
export function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
