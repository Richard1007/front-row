import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  evaluateBenchmark,
  formatBenchmarkSummary,
  loadBenchmarkFixture
} from "../../src/evaluation/benchmark.js";

const fixtureUrl = new URL("./fixtures/front-row-baseline.json", import.meta.url);

describe("Front Row capability benchmark", () => {
  it("measures favorite recall and human-labelled Precision@9 deterministically", async () => {
    const fixture = await loadBenchmarkFixture(fixtureUrl);
    const first = evaluateBenchmark(fixture);
    const second = evaluateBenchmark(fixture);

    expect(second).toEqual(first);
    expect(first.metrics.favoriteRecall).toMatchObject({
      numerator: 3,
      denominator: 3,
      value: 1,
      missedArtists: []
    });
    expect(first.metrics.precisionAtKProxy).toMatchObject({
      numerator: 8,
      denominator: 9,
      value: 8 / 9,
      k: 9,
      unfilledSlots: 0
    });
  });

  it("covers aliases, exact priority, T2/T3 fill, cancellation, and distance boundaries", async () => {
    const report = evaluateBenchmark(await loadBenchmarkFixture(fixtureUrl));

    expect(report.ranking).toHaveLength(9);
    expect(report.ranking.find((item) => item.eventKey === "favorite-wang-alias")?.tier)
      .toBe("T1");
    expect(report.ranking.find((item) => item.eventKey === "favorite-tao-alias")?.tier)
      .toBe("T0");
    expect(report.ranking.slice(0, 3).every((item) => item.tier === "T0" || item.tier === "T1"))
      .toBe(true);
    expect(report.checks.exactArtistsPrecedeDiscovery).toBe(true);
    expect(report.tierCounts).toEqual({ T0: 1, T1: 2, T2: 4, T3: 2 });
    expect(report.checks.expectedExclusions).toEqual({
      passed: true,
      excludedEventKeys: ["cancelled-wang", "far-wang"],
      unexpectedlySelectedEventKeys: []
    });
    expect(report.funnel.rejected.inactive_event).toBe(1);
    expect(report.funnel.rejected.outside_travel_boundary).toBe(1);
  });

  it("emits a concise terminal summary and loads from a filesystem path", async () => {
    const fixture = await loadBenchmarkFixture(fileURLToPath(fixtureUrl));
    const summary = formatBenchmarkSummary(evaluateBenchmark(fixture));

    expect(summary).toContain("Favorite Recall: 3/3 (100.0%)");
    expect(summary).toContain("Precision@9 proxy: 8/9 (88.9%)");
    expect(summary).toContain("Selected: 9 (T0 1, T1 2, T2 4, T3 2)");
    expect(summary).toContain("Expected exclusions: pass");
  });
});
