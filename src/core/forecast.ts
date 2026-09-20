export const DEFAULT_FORECAST_MONTHS = 4;

export function forecastMonths(value?: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FORECAST_MONTHS;
  return Math.max(1, Math.min(DEFAULT_FORECAST_MONTHS, Math.floor(value!)));
}

/** Product semantics are calendar months, not a fixed number of elapsed days. */
export function forecastEnd(now: Date, months?: number): Date {
  const result = new Date(now);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + forecastMonths(months));
  const finalDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, finalDayOfTargetMonth));
  return result;
}
