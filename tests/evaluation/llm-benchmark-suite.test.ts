import { describe, expect, it } from "vitest";

import {
  loadLlmBenchmarkCase,
  scoreLlmBenchmarkCase,
  scoreLlmBenchmarkSuite
} from "../../src/evaluation/llm-benchmark-suite.js";
import { prepareLlmEvaluation } from "../../src/evaluation/llm-comparison.js";

const fixtureUrls = [
  new URL("./fixtures/llm-baseline.json", import.meta.url),
  new URL("./fixtures/llm-oys-jazz-cross-language.json", import.meta.url),
  new URL("./fixtures/llm-popular-irrelevance-trap.json", import.meta.url)
] as const;

async function loadCases() {
  return Promise.all(fixtureUrls.map((url) => loadLlmBenchmarkCase(url)));
}

describe("small-scale LLM benchmark suite", () => {
  it("loads three discriminative, fully human-labelled cases", async () => {
    const cases = await loadCases();

    expect(cases.map((item) => item.fixture.id)).toEqual([
      "llm-baseline",
      "llm-oys-jazz-cross-language",
      "llm-popular-irrelevance-trap"
    ]);
    for (const benchmarkCase of cases) {
      expect(Object.keys(benchmarkCase.humanRelevanceAnnotations)).toHaveLength(
        benchmarkCase.fixture.events.length
      );
      expect(Object.values(benchmarkCase.humanRelevanceAnnotations).every(
        (annotation) => annotation.rationale.length > 0
      )).toBe(true);
      const prepared = prepareLlmEvaluation(benchmarkCase.fixture);
      expect(prepared.lockedExactEvents.length).toBeGreaterThan(0);
      expect(prepared.candidatePayload.candidateEvents.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("scores exact recall, precision among selected, useful fill, and selected count", async () => {
    const cases = await loadCases();
    const scores = cases.map((benchmarkCase) =>
      scoreLlmBenchmarkCase(benchmarkCase, benchmarkCase.referenceSelectionIds)
    );

    expect(scores.map((score) => score.exactRecall.value)).toEqual([1, 1, 1]);
    expect(scores.map((score) => score.precisionAmongSelected.value)).toEqual([1, 1, 1]);
    expect(scores.map((score) => score.usefulFill.value)).toEqual([1, 1, 1]);
    expect(scores.map((score) => score.selectedCount)).toEqual([5, 5, 5]);
    expect(scores.map((score) => score.discoverySelectedCount)).toEqual([3, 4, 4]);
  });

  it("penalizes popular but irrelevant padding without penalizing a concise useful list", async () => {
    const cases = await loadCases();
    const trap = cases[2]!;
    const concise = scoreLlmBenchmarkCase(trap, trap.referenceSelectionIds);
    const padded = scoreLlmBenchmarkCase(trap, [
      ...trap.referenceSelectionIds,
      "trap-taylor-swift",
      "trap-imagine-dragons",
      "trap-coldplay",
      "trap-generic-alt-festival"
    ]);

    expect(concise.usefulFill.value).toBe(1);
    expect(concise.precisionAmongSelected.value).toBe(1);
    expect(padded.usefulFill.value).toBe(1);
    expect(padded.precisionAmongSelected.value).toBe(5 / 9);
    expect(padded.selectedCount).toBe(9);
  });

  it("aggregates all four metrics across cases", async () => {
    const cases = await loadCases();
    const selections = Object.fromEntries(
      cases.map((benchmarkCase) => [
        benchmarkCase.fixture.id,
        benchmarkCase.referenceSelectionIds
      ])
    );
    const report = scoreLlmBenchmarkSuite(cases, selections);

    expect(report.aggregate).toEqual({
      exactRecall: { numerator: 4, denominator: 4, value: 1 },
      precisionAmongSelected: { numerator: 15, denominator: 15, value: 1 },
      usefulFill: { numerator: 15, denominator: 15, value: 1 },
      selectedCount: 15,
      averageSelectedCount: 5
    });
  });

  it("rejects unknown, duplicate, and over-capacity model selections", async () => {
    const [baseline] = await loadCases();
    expect(() => scoreLlmBenchmarkCase(baseline!, ["invented-event"]))
      .toThrow("non-candidates");
    expect(() => scoreLlmBenchmarkCase(baseline!, ["baseline-jj-lin", "baseline-jj-lin"]))
      .toThrow("duplicate IDs");
  });
});
