import { readFile } from "node:fs/promises";

import {
  buildRecommendationSelection,
  validateInput,
  type NormalizedEvent,
  type RecommendationFunnel,
  type RecommendationTier,
  type ValidationInput
} from "../core/index.js";

export interface KnownFavoriteShow {
  artist: string;
  eventKeys: string[];
}

export interface BenchmarkFixture {
  id: string;
  description: string;
  now: string;
  precisionK: number;
  input: ValidationInput;
  events: NormalizedEvent[];
  knownFavoriteShows: KnownFavoriteShow[];
  relevanceLabels: Record<string, boolean>;
  expectedExcludedEventKeys: string[];
}

export interface RatioMetric {
  numerator: number;
  denominator: number;
  value: number | null;
}

export interface FavoriteRecallMetric extends RatioMetric {
  recalledArtists: string[];
  missedArtists: string[];
}

export interface PrecisionMetric extends RatioMetric {
  k: number;
  unfilledSlots: number;
}

export interface EvaluatedRanking {
  rank: number;
  eventKey: string;
  name: string;
  tier: RecommendationTier;
  relevant: boolean;
}

export interface BenchmarkReport {
  schemaVersion: 1;
  benchmark: {
    id: string;
    description: string;
    now: string;
  };
  metrics: {
    favoriteRecall: FavoriteRecallMetric;
    precisionAtKProxy: PrecisionMetric;
  };
  ranking: EvaluatedRanking[];
  tierCounts: Record<RecommendationTier, number>;
  checks: {
    exactArtistsPrecedeDiscovery: boolean;
    expectedExclusions: {
      passed: boolean;
      excludedEventKeys: string[];
      unexpectedlySelectedEventKeys: string[];
    };
  };
  funnel: RecommendationFunnel;
}

function metric(numerator: number, denominator: number): RatioMetric {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator
  };
}

function assertFixture(fixture: BenchmarkFixture): void {
  if (!fixture.id.trim()) throw new Error("Benchmark fixture id is required");
  if (!Number.isFinite(Date.parse(fixture.now))) {
    throw new Error(`Benchmark fixture ${fixture.id} has an invalid now timestamp`);
  }
  if (!Number.isInteger(fixture.precisionK) || fixture.precisionK < 1) {
    throw new Error(`Benchmark fixture ${fixture.id} must use a positive integer precisionK`);
  }
  if (fixture.knownFavoriteShows.some((item) => item.eventKeys.length === 0)) {
    throw new Error(`Benchmark fixture ${fixture.id} has a favorite without a known show`);
  }
  const unlabeledEvents = fixture.events
    .map((event) => event.canonicalKey)
    .filter((eventKey) => fixture.relevanceLabels[eventKey] === undefined);
  if (unlabeledEvents.length > 0) {
    throw new Error(
      `Benchmark fixture ${fixture.id} has unlabeled events: ${unlabeledEvents.join(", ")}`
    );
  }
}

export async function loadBenchmarkFixture(source: string | URL): Promise<BenchmarkFixture> {
  const raw = JSON.parse(await readFile(source, "utf8")) as BenchmarkFixture;
  const validatedInput = validateInput(raw.input);
  // Zod intentionally strips server-only enrichment fields. Preserve those
  // fixture fields after validating the user-controlled portion of the input.
  const fixture = { ...raw, input: { ...raw.input, ...validatedInput } };
  assertFixture(fixture);
  return fixture;
}

/**
 * Runs the production recommendation core against fixed, human-labelled data.
 * Unfilled Precision@K slots count as non-relevant so the metric captures both
 * recommendation quality and the product goal of a useful, compact digest.
 */
export function evaluateBenchmark(fixture: BenchmarkFixture): BenchmarkReport {
  assertFixture(fixture);
  const selection = buildRecommendationSelection(fixture.input, fixture.events, {
    now: new Date(fixture.now),
    limit: fixture.precisionK
  });

  const exactEventKeys = new Set(
    selection.recommendations
      .filter((event) => event.tier === "T0" || event.tier === "T1")
      .map((event) => event.canonicalKey)
  );
  const recalledArtists = fixture.knownFavoriteShows
    .filter((favorite) => favorite.eventKeys.some((key) => exactEventKeys.has(key)))
    .map((favorite) => favorite.artist);
  const recalledArtistSet = new Set(recalledArtists);
  const favoriteRatio = metric(recalledArtists.length, fixture.knownFavoriteShows.length);

  const recommendationsAtK = selection.recommendations.slice(0, fixture.precisionK);
  const ranking = recommendationsAtK.map((event, index) => {
    const relevant = fixture.relevanceLabels[event.canonicalKey];
    if (relevant === undefined) {
      throw new Error(
        `Benchmark fixture ${fixture.id} is missing a relevance label for ${event.canonicalKey}`
      );
    }
    return {
      rank: index + 1,
      eventKey: event.canonicalKey,
      name: event.name,
      tier: event.tier,
      relevant
    };
  });
  const relevantCount = ranking.filter((item) => item.relevant).length;
  const precisionRatio = metric(relevantCount, fixture.precisionK);

  const tierCounts: Record<RecommendationTier, number> = { T0: 0, T1: 0, T2: 0, T3: 0 };
  for (const event of selection.recommendations) tierCounts[event.tier] += 1;

  const firstDiscoveryIndex = selection.recommendations.findIndex(
    (event) => event.tier === "T2" || event.tier === "T3"
  );
  const exactArtistsPrecedeDiscovery = selection.recommendations.every(
    (event, index) =>
      (event.tier !== "T0" && event.tier !== "T1") ||
      firstDiscoveryIndex === -1 ||
      index < firstDiscoveryIndex
  );
  const selectedKeys = new Set(selection.recommendations.map((event) => event.canonicalKey));
  const unexpectedlySelectedEventKeys = fixture.expectedExcludedEventKeys.filter((key) =>
    selectedKeys.has(key)
  );

  return {
    schemaVersion: 1,
    benchmark: {
      id: fixture.id,
      description: fixture.description,
      now: fixture.now
    },
    metrics: {
      favoriteRecall: {
        ...favoriteRatio,
        recalledArtists,
        missedArtists: fixture.knownFavoriteShows
          .map((item) => item.artist)
          .filter((artist) => !recalledArtistSet.has(artist))
      },
      precisionAtKProxy: {
        ...precisionRatio,
        k: fixture.precisionK,
        unfilledSlots: Math.max(0, fixture.precisionK - recommendationsAtK.length)
      }
    },
    ranking,
    tierCounts,
    checks: {
      exactArtistsPrecedeDiscovery,
      expectedExclusions: {
        passed: unexpectedlySelectedEventKeys.length === 0,
        excludedEventKeys: fixture.expectedExcludedEventKeys.filter(
          (key) => !selectedKeys.has(key)
        ),
        unexpectedlySelectedEventKeys
      }
    },
    funnel: selection.funnel
  };
}

function percentage(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function formatBenchmarkSummary(report: BenchmarkReport): string {
  const recall = report.metrics.favoriteRecall;
  const precision = report.metrics.precisionAtKProxy;
  return [
    `Front Row benchmark: ${report.benchmark.id}`,
    `Favorite Recall: ${recall.numerator}/${recall.denominator} (${percentage(recall.value)})`,
    `Precision@${precision.k} proxy: ${precision.numerator}/${precision.denominator} (${percentage(precision.value)})`,
    `Selected: ${report.ranking.length} (T0 ${report.tierCounts.T0}, T1 ${report.tierCounts.T1}, T2 ${report.tierCounts.T2}, T3 ${report.tierCounts.T3})`,
    `Expected exclusions: ${report.checks.expectedExclusions.passed ? "pass" : "FAIL"}`
  ].join("\n");
}
