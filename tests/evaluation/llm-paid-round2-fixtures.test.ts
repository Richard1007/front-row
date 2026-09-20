import { describe, expect, it } from "vitest";

import { loadLlmBenchmarkCase } from "../../src/evaluation/llm-benchmark-suite.js";
import { prepareLlmEvaluation } from "../../src/evaluation/llm-comparison.js";

const cases = [
  ["exact-favorite-pressure", "./fixtures/llm-exact-favorite-pressure.json"],
  ["no-padding/silent-week", "./fixtures/llm-no-padding-silent-week.json"],
  ["language-only false positives", "./fixtures/llm-language-only-false-positives.json"],
  ["bilingual alias/duplicate risk", "./fixtures/llm-bilingual-alias-duplicate-risk.json"],
  ["cross-language R&B", "./fixtures/llm-cross-language-rnb.json"],
  ["broad-genre noise", "./fixtures/llm-broad-genre-noise.json"],
  ["sparse niche taste", "./fixtures/llm-sparse-niche-taste.json"]
] as const;

async function loadAll() {
  return Promise.all(cases.map(async ([category, path]) => ({
    category,
    benchmarkCase: await loadLlmBenchmarkCase(new URL(path, import.meta.url))
  })));
}

describe("paid evaluation round-two fixture validity", () => {
  it("provides seven distinct difficult cases with complete human labels", async () => {
    const loaded = await loadAll();
    expect(loaded).toHaveLength(7);
    expect(new Set(loaded.map(({ benchmarkCase }) => benchmarkCase.fixture.id)).size).toBe(7);

    for (const { benchmarkCase } of loaded) {
      expect(Object.keys(benchmarkCase.humanRelevanceAnnotations)).toHaveLength(
        benchmarkCase.fixture.events.length
      );
      expect(Object.values(benchmarkCase.humanRelevanceAnnotations).every(
        ({ rationale }) => rationale.trim().length > 0
      )).toBe(true);
    }
  });

  it("actually exposes useful and distracting T2/T3 candidates under the current core", async () => {
    const loaded = await loadAll();
    for (const { category, benchmarkCase } of loaded) {
      const prepared = prepareLlmEvaluation(benchmarkCase.fixture);
      const candidates = prepared.candidatePayload.candidateEvents;
      const relevant = candidates.filter(
        ({ id }) => benchmarkCase.humanRelevanceAnnotations[id]?.relevant
      );
      const distractors = candidates.filter(
        ({ id }) => benchmarkCase.humanRelevanceAnnotations[id]?.relevant === false
      );

      expect(relevant.length, `${category} relevant candidates`).toBeGreaterThan(0);
      expect(distractors.length, `${category} distractor candidates`).toBeGreaterThan(0);
      expect(candidates.every(({ tier }) => tier === "T2" || tier === "T3")).toBe(true);
      expect(benchmarkCase.referenceSelectionIds.every(
        (id) => benchmarkCase.humanRelevanceAnnotations[id]?.relevant
      )).toBe(true);
    }
  });

  it("keeps all exact favorites locked in the pressure case", async () => {
    const loaded = await loadAll();
    const benchmarkCase = loaded[0]!.benchmarkCase;
    const prepared = prepareLlmEvaluation(benchmarkCase.fixture);
    expect(prepared.lockedExactEvents).toHaveLength(4);
    expect(prepared.candidatePayload.policy.maximumSelections).toBe(5);
  });

  it("makes the silent-week reference deliberately concise", async () => {
    const loaded = await loadAll();
    const silent = loaded[1]!.benchmarkCase;
    const prepared = prepareLlmEvaluation(silent.fixture);
    expect(prepared.lockedExactEvents).toHaveLength(0);
    expect(silent.referenceSelectionIds).toHaveLength(3);
    expect(prepared.candidatePayload.candidateEvents.length).toBeGreaterThan(3);
  });

  it("deduplicates bilingual exact aliases across providers", async () => {
    const loaded = await loadAll();
    const aliasCase = loaded[3]!.benchmarkCase;
    const prepared = prepareLlmEvaluation(aliasCase.fixture);
    expect(prepared.lockedExactEvents).toHaveLength(1);
    expect(prepared.lockedExactEvents[0]).toMatchObject({ canonicalKey: "alias-jay-jb" });
    expect(prepared.lockedExactEvents[0]?.sources.map(({ provider }) => provider).sort())
      .toEqual(["jambase", "ticketmaster"]);
  });

  it("contains explicit cross-language relevant candidates and same-language false positives", async () => {
    const loaded = await loadAll();
    const languageOnly = prepareLlmEvaluation(loaded[2]!.benchmarkCase.fixture);
    const crossRnb = prepareLlmEvaluation(loaded[4]!.benchmarkCase.fixture);
    const languageIds = new Set(languageOnly.candidatePayload.candidateEvents.map(({ id }) => id));
    const rnbIds = new Set(crossRnb.candidatePayload.candidateEvents.map(({ id }) => id));

    expect([...languageIds]).toEqual(expect.arrayContaining([
      "language-opera", "language-metal", "language-comedy", "language-generic-pop",
      "language-hiphop"
    ]));
    expect([...rnbIds]).toEqual(expect.arrayContaining([
      "rnb-dangelo", "rnb-anderson", "rnb-dean", "rnb-her",
      "rnb-mandarin-ballad", "rnb-english-pop"
    ]));
  });
});
