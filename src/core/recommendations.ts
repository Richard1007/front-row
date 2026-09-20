import { deduplicateEvents } from "./deduplication.js";
import { enrichEvent, enrichValidationInput } from "./enrichment.js";
import { estimateDrivingTravel } from "./geo.js";
import type {
  ArtistSimilarityEvidence,
  ImportanceLevel,
  LanguageEvidence,
  NormalizedEvent,
  RankedEvent,
  RecommendationTier,
  ValidationInput,
  WeightedPreference
} from "./types.js";

const DIMENSION_WEIGHTS = {
  artist: 0.6,
  genre: 0.25,
  language: 0.15
} as const;

const IMPORTANCE_VALUES: Record<ImportanceLevel, number> = {
  priority: 1,
  like: 0.5,
  occasional: 0.25
};

const TIER_ORDER: Record<RecommendationTier, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3
};

const RELIABLE_LANGUAGE_CONFIDENCE = 0.5;
const DISCOVERY_THRESHOLD = 0.25;
const EXPLORATION_THRESHOLD = 0.15;
const DEFAULT_RESULT_LIMIT = 8;

export interface RecommendationOptions {
  now?: Date;
  limit?: number;
}

interface DimensionValue {
  match: number;
  confidence: number;
  label?: string;
}

interface ExactArtistMatch {
  preference: WeightedPreference;
  performerName: string;
}

function normalizedText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function displayLanguage(value: string): string {
  const labels: Record<string, string> = {
    cmn: "普通话",
    en: "英语",
    yue: "粤语"
  };
  return labels[value] ?? value;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isTributeEvent(event: NormalizedEvent): boolean {
  if (event.isTribute) return true;
  const text = normalizedText(
    [event.name, ...event.performers.map((performer) => performer.name)].join(" ")
  );
  return /\btribute\b|致敬/.test(text);
}

function preferenceNames(preference: WeightedPreference): string[] {
  return [preference.name, ...(preference.aliases ?? [])].map(normalizedText);
}

function exactArtistMatch(
  event: NormalizedEvent,
  preferences: WeightedPreference[]
): ExactArtistMatch | undefined {
  if (isTributeEvent(event)) return undefined;

  let best: ExactArtistMatch | undefined;
  for (const preference of preferences) {
    const names = new Set(preferenceNames(preference));
    for (const performer of event.performers) {
      const canonicalMatch =
        Boolean(preference.canonicalId) && performer.canonicalId === preference.canonicalId;
      const confirmedNameMatch = names.has(normalizedText(performer.name));
      if (canonicalMatch || confirmedNameMatch) {
        const candidate = { preference, performerName: performer.name };
        if (
          !best ||
          IMPORTANCE_VALUES[candidate.preference.weight] >
            IMPORTANCE_VALUES[best.preference.weight]
        ) {
          best = candidate;
        }
      }
    }
  }

  return best;
}

function affinityReferencesPreference(
  affinity: ArtistSimilarityEvidence,
  preference: WeightedPreference
): boolean {
  if (
    affinity.preferenceCanonicalId &&
    preference.canonicalId &&
    affinity.preferenceCanonicalId === preference.canonicalId
  ) {
    return true;
  }
  return Boolean(
    affinity.preferenceName &&
      preferenceNames(preference).includes(normalizedText(affinity.preferenceName))
  );
}

function artistDimension(
  event: NormalizedEvent,
  preferences: WeightedPreference[],
  exact: ExactArtistMatch | undefined
): DimensionValue | undefined {
  if (exact) {
    return {
      match: IMPORTANCE_VALUES[exact.preference.weight],
      confidence: 1,
      label: exact.preference.name
    };
  }

  let best: DimensionValue | undefined;
  for (const performer of event.performers) {
    for (const affinity of performer.similarTo ?? []) {
      for (const preference of preferences) {
        if (!affinityReferencesPreference(affinity, preference)) continue;
        const sourceCeiling =
          affinity.source === "manual" ? 0.85 : affinity.source === "provider" ? 0.7 : 0.45;
        const match =
          Math.min(clampUnit(affinity.score), sourceCeiling) * IMPORTANCE_VALUES[preference.weight];
        const candidate = {
          match,
          confidence: clampUnit(affinity.confidence),
          label: preference.name
        };
        if (!best || candidate.match * candidate.confidence > best.match * best.confidence) {
          best = candidate;
        }
      }
    }
  }
  return best;
}

function genreDimension(
  event: NormalizedEvent,
  preferences: WeightedPreference[]
): DimensionValue | undefined {
  if (preferences.length === 0 || event.genres.length === 0) return undefined;

  const eventGenres = new Set(event.genres.map(normalizedText));
  let bestMatch = 0;
  let bestLabel: string | undefined;
  for (const preference of preferences) {
    if (!eventGenres.has(normalizedText(preference.name))) continue;
    const match = IMPORTANCE_VALUES[preference.weight];
    if (match > bestMatch) {
      bestMatch = match;
      bestLabel = preference.name;
    }
  }

  return { match: bestMatch, confidence: 1, label: bestLabel };
}

const LANGUAGE_ROLE_MATCH: Record<LanguageEvidence["role"], number> = {
  primary: 1,
  significant: 0.65,
  occasional: 0.35
};

function languageDimension(
  event: NormalizedEvent,
  input: ValidationInput
): DimensionValue | undefined {
  if (input.languageMode === "any") return undefined;
  const reliableEvidence = event.languages.filter(
    (language) => language.source !== "unknown" && language.confidence >= RELIABLE_LANGUAGE_CONFIDENCE
  );
  if (reliableEvidence.length === 0) return undefined;

  const desiredShares = new Map(
    input.languages.map((language) => [normalizedText(language.language), language.percentage / 100])
  );
  let best: DimensionValue = { match: 0, confidence: 1 };
  for (const evidence of reliableEvidence) {
    const desiredShare = desiredShares.get(normalizedText(evidence.language)) ?? 0;
    const candidate = {
      match: desiredShare * LANGUAGE_ROLE_MATCH[evidence.role],
      confidence: clampUnit(evidence.confidence),
      label: desiredShare > 0 ? evidence.language : undefined
    };
    if (candidate.match * candidate.confidence > best.match * best.confidence) best = candidate;
  }
  return best;
}

function weightedScore(dimensions: {
  artist?: DimensionValue;
  genre?: DimensionValue;
  language?: DimensionValue;
}) {
  let numerator = 0;
  let denominator = 0;

  for (const key of ["artist", "genre", "language"] as const) {
    const dimension = dimensions[key];
    if (!dimension) continue;
    const contributionWeight = DIMENSION_WEIGHTS[key] * dimension.confidence;
    numerator += contributionWeight * dimension.match;
    denominator += contributionWeight;
  }

  return {
    final: denominator === 0 ? 0 : numerator / denominator,
    coverage: denominator
  };
}

function tierFor(
  event: NormalizedEvent,
  exact: ExactArtistMatch | undefined,
  score: number,
  now: Date
): RecommendationTier {
  if (exact) {
    const futureOnSale = event.onSaleAt ? Date.parse(event.onSaleAt) >= now.getTime() : false;
    if (futureOnSale) return "T0";
    return "T1";
  }
  return score >= DISCOVERY_THRESHOLD ? "T2" : "T3";
}

function reasonFor(
  tier: RecommendationTier,
  exact: ExactArtistMatch | undefined,
  dimensions: {
    artist?: DimensionValue;
    genre?: DimensionValue;
    language?: DimensionValue;
  },
  event: NormalizedEvent
): string {
  const reasons: string[] = [];

  if (tier === "T0" && event.onSaleAt) reasons.push("你关注的演出即将开票");
  else if (exact) reasons.push(`${exact.preference.name} 是你明确选择的艺人`);
  else if (dimensions.artist?.label) reasons.push(`与 ${dimensions.artist.label} 风格相近`);

  if (dimensions.genre?.label && dimensions.genre.match > 0) {
    reasons.push(`符合你对 ${dimensions.genre.label} 的偏好`);
  }
  if (dimensions.language?.label && dimensions.language.match > 0) {
    reasons.push(`演唱语言包含 ${displayLanguage(dimensions.language.label)}`);
  }

  if (reasons.length === 0) return "在你的出行范围内，作为少量探索推荐";
  return reasons.join("；");
}

function warningsFor(event: NormalizedEvent, input: ValidationInput): string[] {
  const warnings = ["出行时间为直线距离估算，实际路况可能不同"];
  if (event.genres.length === 0) warnings.push("暂无可靠的风格信息，未因此降低排名");
  if (
    input.languageMode === "weighted" &&
    !event.languages.some(
      (language) =>
        language.source !== "unknown" && language.confidence >= RELIABLE_LANGUAGE_CONFIDENCE
    )
  ) {
    warnings.push("暂无可靠的演唱语言信息，未因此降低排名");
  }
  if (event.status === "unknown") warnings.push("演出状态尚未确认");
  return warnings;
}

function eligibleByDate(event: NormalizedEvent, now: Date, forecastDays: number): boolean {
  const eventTime = Date.parse(event.startAt);
  if (!Number.isFinite(eventTime)) return false;
  const windowEnd = now.getTime() + forecastDays * 24 * 60 * 60 * 1_000;
  return eventTime >= now.getTime() && eventTime <= windowEnd;
}

function rankEvent(
  input: ValidationInput,
  event: NormalizedEvent,
  now: Date
): RankedEvent | undefined {
  if (!eligibleByDate(event, now, input.forecastDays ?? 90)) return undefined;
  if (!event.venue.coordinates) return undefined;

  const exact = exactArtistMatch(event, input.artists);
  if (event.status !== "active") return undefined;

  const travel = estimateDrivingTravel(input.origin, event.venue.coordinates);
  if (travel.travelMinutes > input.maxTravelMinutes) return undefined;

  const dimensions = {
    artist: artistDimension(event, input.artists, exact),
    genre: genreDimension(event, input.genres),
    language: languageDimension(event, input)
  };
  const aggregate = weightedScore(dimensions);
  const tier = tierFor(event, exact, aggregate.final, now);

  if (tier === "T3" && aggregate.final < EXPLORATION_THRESHOLD) return undefined;

  return {
    ...event,
    tier,
    score: {
      artist: dimensions.artist?.match,
      genre: dimensions.genre?.match,
      language: dimensions.language?.match,
      coverage: aggregate.coverage,
      final: aggregate.final
    },
    reason: reasonFor(tier, exact, dimensions, event),
    estimatedTravelMinutes: travel.travelMinutes,
    distanceMiles: travel.distanceMiles,
    warnings: warningsFor(event, input)
  };
}

/**
 * Provider-neutral recommendation pipeline: deduplicate, filter, score, explain,
 * and return at most eight strong events. Every T0/T1 result precedes discovery.
 */
export function buildRecommendations(
  input: ValidationInput,
  events: NormalizedEvent[],
  options: RecommendationOptions = {}
): RankedEvent[] {
  const now = options.now ?? new Date();
  const limit = Math.min(DEFAULT_RESULT_LIMIT, Math.max(1, options.limit ?? DEFAULT_RESULT_LIMIT));
  const enrichedInput = enrichValidationInput(input);
  const enrichedEvents = events.map(enrichEvent);

  const ranked = deduplicateEvents(enrichedEvents)
    .map((event) => rankEvent(enrichedInput, event, now))
    .filter((event): event is RankedEvent => Boolean(event))
    .sort((left, right) => {
      const tierDifference = TIER_ORDER[left.tier] - TIER_ORDER[right.tier];
      if (tierDifference !== 0) return tierDifference;
      const scoreDifference = right.score.final - left.score.final;
      if (scoreDifference !== 0) return scoreDifference;
      const dateDifference = Date.parse(left.startAt) - Date.parse(right.startAt);
      if (dateDifference !== 0) return dateDifference;
      return left.canonicalKey.localeCompare(right.canonicalKey);
    });

  const results: RankedEvent[] = [];
  let explorationIncluded = false;
  for (const event of ranked) {
    if (event.tier === "T3") {
      if (explorationIncluded) continue;
      explorationIncluded = true;
    }
    results.push(event);
    if (results.length >= limit) break;
  }
  return results;
}
