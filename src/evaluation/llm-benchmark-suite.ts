import { readFile } from "node:fs/promises";

import type { BenchmarkFixture, RatioMetric } from "./benchmark.js";
import { loadBenchmarkFixture } from "./benchmark.js";
import { prepareLlmEvaluation } from "./llm-comparison.js";

export interface HumanRelevanceAnnotation {
  relevant: boolean;
  rationale: string;
}

export interface LlmBenchmarkCase {
  fixture: BenchmarkFixture;
  humanRelevanceAnnotations: Record<string, HumanRelevanceAnnotation>;
  referenceSelectionIds: string[];
}

export interface LlmCaseScore {
  caseId: string;
  exactRecall: RatioMetric;
  precisionAmongSelected: RatioMetric;
  usefulFill: RatioMetric;
  selectedCount: number;
  discoverySelectedCount: number;
  selectedEventIds: string[];
  lockedExactEventIds: string[];
}

export interface LlmSuiteScore {
  cases: LlmCaseScore[];
  aggregate: {
    exactRecall: RatioMetric;
    precisionAmongSelected: RatioMetric;
    usefulFill: RatioMetric;
    selectedCount: number;
    averageSelectedCount: number;
  };
}

interface RawLlmBenchmarkCase extends BenchmarkFixture {
  humanRelevanceAnnotations: Record<string, HumanRelevanceAnnotation>;
  referenceSelectionIds: string[];
}

function ratio(numerator: number, denominator: number): RatioMetric {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator
  };
}

function validateHumanLabels(raw: RawLlmBenchmarkCase, fixture: BenchmarkFixture): void {
  const eventIds = new Set(fixture.events.map((event) => event.canonicalKey));
  const missing = [...eventIds].filter((id) => !raw.humanRelevanceAnnotations[id]);
  if (missing.length > 0) {
    throw new Error(`${fixture.id} is missing human relevance annotations: ${missing.join(", ")}`);
  }
  for (const [id, annotation] of Object.entries(raw.humanRelevanceAnnotations)) {
    if (!eventIds.has(id)) throw new Error(`${fixture.id} labels unknown event ${id}`);
    if (!annotation.rationale.trim()) throw new Error(`${fixture.id} has an empty rationale for ${id}`);
    if (fixture.relevanceLabels[id] !== annotation.relevant) {
      throw new Error(`${fixture.id} has conflicting relevance labels for ${id}`);
    }
  }
}

export async function loadLlmBenchmarkCase(source: string | URL): Promise<LlmBenchmarkCase> {
  const raw = JSON.parse(await readFile(source, "utf8")) as RawLlmBenchmarkCase;
  const fixture = await loadBenchmarkFixture(source);
  validateHumanLabels(raw, fixture);
  const prepared = prepareLlmEvaluation(fixture);
  const candidateIds = new Set(prepared.candidatePayload.candidateEvents.map((event) => event.id));
  const invalidReferenceIds = raw.referenceSelectionIds.filter((id) => !candidateIds.has(id));
  if (invalidReferenceIds.length > 0) {
    throw new Error(
      `${fixture.id} reference selection includes non-candidates: ${invalidReferenceIds.join(", ")}`
    );
  }
  if (new Set(raw.referenceSelectionIds).size !== raw.referenceSelectionIds.length) {
    throw new Error(`${fixture.id} reference selection contains duplicate IDs`);
  }
  if (raw.referenceSelectionIds.length > prepared.candidatePayload.policy.maximumSelections) {
    throw new Error(`${fixture.id} reference selection exceeds the available slots`);
  }
  return {
    fixture,
    humanRelevanceAnnotations: raw.humanRelevanceAnnotations,
    referenceSelectionIds: raw.referenceSelectionIds
  };
}

/**
 * usefulFill is recall over the useful capacity of the digest: the number of
 * human-relevant events that can actually fit, not an incentive to pad to K.
 */
export function scoreLlmBenchmarkCase(
  benchmarkCase: LlmBenchmarkCase,
  discoverySelectionIds: string[]
): LlmCaseScore {
  const { fixture } = benchmarkCase;
  const prepared = prepareLlmEvaluation(fixture);
  const candidateIds = new Set(prepared.candidatePayload.candidateEvents.map((event) => event.id));
  if (new Set(discoverySelectionIds).size !== discoverySelectionIds.length) {
    throw new Error(`${fixture.id} selection contains duplicate IDs`);
  }
  const invalidIds = discoverySelectionIds.filter((id) => !candidateIds.has(id));
  if (invalidIds.length > 0) {
    throw new Error(`${fixture.id} selection contains non-candidates: ${invalidIds.join(", ")}`);
  }
  if (discoverySelectionIds.length > prepared.candidatePayload.policy.maximumSelections) {
    throw new Error(`${fixture.id} selection exceeds the available slots`);
  }

  const lockedExactEventIds = prepared.lockedExactEvents.map((event) => event.canonicalKey);
  const lockedSet = new Set(lockedExactEventIds);
  const exactRecalled = fixture.knownFavoriteShows.filter((favorite) =>
    favorite.eventKeys.some((eventId) => lockedSet.has(eventId))
  ).length;
  const selectedEventIds = [...lockedExactEventIds, ...discoverySelectionIds]
    .slice(0, fixture.precisionK);
  const relevantSelected = selectedEventIds.filter(
    (id) => benchmarkCase.humanRelevanceAnnotations[id]?.relevant
  ).length;

  const potentiallyUsefulIds = new Set<string>();
  for (const favorite of fixture.knownFavoriteShows) {
    for (const id of favorite.eventKeys) {
      if (benchmarkCase.humanRelevanceAnnotations[id]?.relevant) potentiallyUsefulIds.add(id);
    }
  }
  for (const candidate of prepared.candidatePayload.candidateEvents) {
    if (benchmarkCase.humanRelevanceAnnotations[candidate.id]?.relevant) {
      potentiallyUsefulIds.add(candidate.id);
    }
  }
  const usefulCapacity = Math.min(fixture.precisionK, potentiallyUsefulIds.size);

  return {
    caseId: fixture.id,
    exactRecall: ratio(exactRecalled, fixture.knownFavoriteShows.length),
    precisionAmongSelected: ratio(relevantSelected, selectedEventIds.length),
    usefulFill: ratio(relevantSelected, usefulCapacity),
    selectedCount: selectedEventIds.length,
    discoverySelectedCount: discoverySelectionIds.length,
    selectedEventIds,
    lockedExactEventIds
  };
}

export function scoreLlmBenchmarkSuite(
  cases: readonly LlmBenchmarkCase[],
  selectionsByCase: Readonly<Record<string, readonly string[]>>
): LlmSuiteScore {
  const scores = cases.map((benchmarkCase) => {
    const selection = selectionsByCase[benchmarkCase.fixture.id];
    if (!selection) throw new Error(`Missing selection for ${benchmarkCase.fixture.id}`);
    return scoreLlmBenchmarkCase(benchmarkCase, [...selection]);
  });
  const sumMetric = (key: "exactRecall" | "precisionAmongSelected" | "usefulFill") => {
    const numerator = scores.reduce((sum, score) => sum + score[key].numerator, 0);
    const denominator = scores.reduce((sum, score) => sum + score[key].denominator, 0);
    return ratio(numerator, denominator);
  };
  const selectedCount = scores.reduce((sum, score) => sum + score.selectedCount, 0);
  return {
    cases: scores,
    aggregate: {
      exactRecall: sumMetric("exactRecall"),
      precisionAmongSelected: sumMetric("precisionAmongSelected"),
      usefulFill: sumMetric("usefulFill"),
      selectedCount,
      averageSelectedCount: cases.length === 0 ? 0 : selectedCount / cases.length
    }
  };
}
