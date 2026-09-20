export const DEFAULT_FORECAST_MONTHS = 3;

export function forecastMonths(value?: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FORECAST_MONTHS;
  return Math.max(1, Math.min(DEFAULT_FORECAST_MONTHS, Math.floor(value!)));
}

/**
 * Product semantics are three calendar months, not 90 elapsed days. The extra
 * UTC day keeps events on the final local calendar date inside the window even
 * when a US evening is represented as the following UTC date.
 */
export function forecastEnd(now: Date, months?: number): Date {
  const result = new Date(now);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + forecastMonths(months));
  const finalDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, finalDayOfTargetMonth) + 1);
  return result;
}
