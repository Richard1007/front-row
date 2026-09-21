import { describe, expect, it } from "vitest";

import { forecastEnd, forecastMonths } from "../../src/core/forecast.js";

describe("selectable calendar-month forecast", () => {
  it("uses four months by default and clamps to one through six", () => {
    expect(forecastMonths()).toBe(4);
    expect(forecastMonths(6)).toBe(6);
    expect(forecastMonths(99)).toBe(6);
    expect(forecastMonths(0)).toBe(1);
  });

  it("supports a six-month window", () => {
    expect(forecastEnd(new Date("2026-09-19T18:00:00.000Z"), 6).toISOString())
      .toBe("2027-03-19T18:00:00.000Z");
  });

  it("preserves the day and time across a year boundary", () => {
    expect(forecastEnd(new Date("2026-09-19T18:00:00.000Z")).toISOString())
      .toBe("2027-01-19T18:00:00.000Z");
  });

  it("clamps month-end dates instead of rolling into the following month", () => {
    expect(forecastEnd(new Date("2027-01-31T08:30:00.000Z")).toISOString())
      .toBe("2027-05-31T08:30:00.000Z");
    expect(forecastEnd(new Date("2023-10-31T08:30:00.000Z")).toISOString())
      .toBe("2024-02-29T08:30:00.000Z");
  });
});
