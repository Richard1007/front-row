import { deduplicateEvents } from "./deduplication.js";
import { enrichEvent, enrichValidationInput } from "./enrichment.js";
import { estimateDrivingTravel } from "./geo.js";
import { forecastEnd } from "./forecast.js";
import type {
  ArtistSimilarityEvidence,
  ImportanceLevel,
  LanguageEvidence,
  NormalizedEvent,
  RankedEvent,
  RecommendationFunnel,
  RecommendationRejectionReason,
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
const DEFAULT_RESULT_LIMIT = 10;
const MAX_RESULT_LIMIT = 10;
const MAX_EXPLORATION_RESULTS = 3;

export interface RecommendationOptions {
  now?: Date;
  limit?: number;
}

interface DimensionValue {
  match: number;
  confidence: number;
  label?: string;
  similaritySource?: ArtistSimilarityEvidence["source"];
  preferenceSource?: "explicit" | "inferred";
}

export interface RecommendationSelection {
  recommendations: RankedEvent[];
  funnel: RecommendationFunnel;
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
        const sourceCeiling: Record<ArtistSimilarityEvidence["source"], number> = {
          manual: 0.85,
          provider: 0.7,
          listenbrainz: 0.75,
          genre: 0.45
        };
        const match =
          Math.min(clampUnit(affinity.score), sourceCeiling[affinity.source]) *
          IMPORTANCE_VALUES[preference.weight];
        const candidate = {
          match,
          confidence: clampUnit(affinity.confidence),
          label: preference.name,
          similaritySource: affinity.source
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
  input: ValidationInput
): DimensionValue | undefined {
  if (event.genres.length === 0) return undefined;

  const eventGenres = new Set(event.genres.map(normalizedText));
  let bestMatch = 0;
  let bestLabel: string | undefined;
  for (const preference of input.genres) {
    if (!eventGenres.has(normalizedText(preference.name))) continue;
    const match = IMPORTANCE_VALUES[preference.weight];
    if (match > bestMatch) {
      bestMatch = match;
      bestLabel = preference.name;
    }
  }

  // A user's explicit category wins whenever it matches. Artist-derived
  // genres only broaden discovery when the user did not select that category.
  if (bestLabel) {
    return {
      match: bestMatch,
      confidence: 1,
      label: bestLabel,
      preferenceSource: "explicit"
    };
  }

  for (const preference of input.inferredGenres ?? []) {
    if (!eventGenres.has(normalizedText(preference.name))) continue;
    const match = clampUnit(preference.percentage / 100);
    if (match > bestMatch) {
      bestMatch = match;
      bestLabel = preference.name;
    }
  }

  if (!bestLabel) return undefined;
  const inferred = input.inferredGenres?.find(
    (preference) => normalizedText(preference.name) === normalizedText(bestLabel)
  );
  return {
    match: bestMatch,
    confidence: clampUnit(inferred?.confidence ?? 1),
    label: bestLabel,
    preferenceSource: "inferred"
  };
}

const LANGUAGE_ROLE_MATCH: Record<LanguageEvidence["role"], number> = {
  primary: 1,
  significant: 0.65,
  occasional: 0.35
};

function languagePreferenceProfile(input: ValidationInput): {
  shares: Map<string, number>;
  confidence: number;
} | undefined {
  if (input.inferredLanguages && input.inferredLanguages.length > 0) {
    return {
      shares: new Map(
        input.inferredLanguages.map((item) => [
          normalizedText(item.language),
          clampUnit(item.percentage / 100)
        ])
      ),
      confidence: 1
    };
  }

  // Accepted languages express openness, not a requested output quota. They
  // are therefore an equal, lower-confidence fallback when artist-derived
  // language evidence is unavailable.
  if (input.languageMode === "weighted" && input.languages.length > 0) {
    const equalShare = 1 / input.languages.length;
    return {
      shares: new Map(
        input.languages.map((item) => [normalizedText(item.language), equalShare])
      ),
      confidence: 0.5
    };
  }

  return undefined;
}

function languageDimension(
  event: NormalizedEvent,
  input: ValidationInput
): DimensionValue | undefined {
  const preferenceProfile = languagePreferenceProfile(input);
  if (!preferenceProfile) return undefined;
  const reliableEvidence = event.languages.filter(
    (language) => language.source !== "unknown" && language.confidence >= RELIABLE_LANGUAGE_CONFIDENCE
  );
  if (reliableEvidence.length === 0) return undefined;

  let best: DimensionValue = { match: 0, confidence: preferenceProfile.confidence };
  for (const evidence of reliableEvidence) {
    const desiredShare = preferenceProfile.shares.get(normalizedText(evidence.language)) ?? 0;
    const candidate = {
      match: desiredShare * LANGUAGE_ROLE_MATCH[evidence.role],
      confidence: clampUnit(evidence.confidence) * preferenceProfile.confidence,
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
  hasSourcedArtistSimilarity: boolean,
  now: Date
): RecommendationTier {
  if (exact) {
    const futureOnSale = event.onSaleAt ? Date.parse(event.onSaleAt) > now.getTime() : false;
    if (futureOnSale) return "T0";
    return "T1";
  }
  return hasSourcedArtistSimilarity ? "T2" : "T3";
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
    reasons.push(
      dimensions.genre.preferenceSource === "inferred"
        ? `根据所选艺人推断你可能喜欢 ${dimensions.genre.label}`
        : `符合你对 ${dimensions.genre.label} 的偏好`
    );
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
    languagePreferenceProfile(input) &&
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

function eligibleByDate(event: NormalizedEvent, now: Date, forecastMonths: number): boolean {
  const eventTime = Date.parse(event.startAt);
  if (!Number.isFinite(eventTime)) return false;
  return eventTime >= now.getTime() && eventTime <= forecastEnd(now, forecastMonths).getTime();
}

function emptyRejectedCounts(): Record<RecommendationRejectionReason, number> {
  return {
    duplicate_event: 0,
    outside_forecast: 0,
    missing_venue_coordinates: 0,
    tribute_event: 0,
    inactive_event: 0,
    outside_travel_boundary: 0,
    no_preference_affinity: 0,
    exploration_cap: 0,
    result_limit: 0
  };
}

function rankEvent(
  input: ValidationInput,
  event: NormalizedEvent,
  now: Date,
  funnel: RecommendationFunnel
): RankedEvent | undefined {
  if (!eligibleByDate(event, now, input.forecastMonths ?? 4)) {
    funnel.rejected.outside_forecast += 1;
    return undefined;
  }
  funnel.insideForecast += 1;

  if (!event.venue.coordinates) {
    funnel.rejected.missing_venue_coordinates += 1;
    return undefined;
  }
  funnel.withVenueCoordinates += 1;

  if (isTributeEvent(event)) {
    funnel.rejected.tribute_event += 1;
    return undefined;
  }

  const exact = exactArtistMatch(event, input.artists);
  if (event.status !== "active") {
    funnel.rejected.inactive_event += 1;
    return undefined;
  }
  funnel.activeNonTribute += 1;

  const travel = estimateDrivingTravel(input.origin, event.venue.coordinates);
  if (travel.travelMinutes > input.maxTravelMinutes) {
    funnel.rejected.outside_travel_boundary += 1;
    return undefined;
  }
  funnel.insideTravelBoundary += 1;

  const dimensions = {
    artist: artistDimension(event, input.artists, exact),
    genre: genreDimension(event, input),
    language: languageDimension(event, input)
  };
  const aggregate = weightedScore(dimensions);
  const hasSourcedArtistSimilarity = Boolean(
    dimensions.artist?.match &&
      dimensions.artist.match > 0 &&
      dimensions.artist.similaritySource &&
      dimensions.artist.similaritySource !== "genre"
  );
  const broadInferredGenre = new Set(["pop", "rock", "world"]);
  const hasGenreAffinity = Boolean(
    dimensions.genre?.match &&
      dimensions.genre.match > 0 &&
      (dimensions.genre.preferenceSource === "explicit" ||
        !broadInferredGenre.has(normalizedText(dimensions.genre.label ?? "")))
  );
  const hasLanguageAffinity = Boolean(
    dimensions.language?.match && dimensions.language.match > 0
  );

  // Explicit artists are always eligible. Discovery needs a positive, sourced
  // affinity, but genre/language weights remain soft ranking signals rather
  // than filters that can veto an otherwise relevant event.
  if (!exact && !hasSourcedArtistSimilarity && !hasGenreAffinity && !hasLanguageAffinity) {
    funnel.rejected.no_preference_affinity += 1;
    return undefined;
  }
  funnel.preferenceEligible += 1;

  const tier = tierFor(event, exact, hasSourcedArtistSimilarity, now);

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
 * and return at most ten strong events. Every T0/T1 result precedes discovery.
 */
export function buildRecommendationSelection(
  input: ValidationInput,
  events: NormalizedEvent[],
  options: RecommendationOptions = {}
): RecommendationSelection {
  const now = options.now ?? new Date();
  const requestedLimit = Number.isFinite(options.limit)
    ? Math.floor(options.limit!)
    : DEFAULT_RESULT_LIMIT;
  const limit = Math.min(MAX_RESULT_LIMIT, Math.max(1, requestedLimit));
  const enrichedInput = enrichValidationInput(input);
  const enrichedEvents = events.map(enrichEvent);
  const deduplicatedEvents = deduplicateEvents(enrichedEvents);
  const funnel: RecommendationFunnel = {
    inputEvents: events.length,
    deduplicatedEvents: deduplicatedEvents.length,
    insideForecast: 0,
    withVenueCoordinates: 0,
    activeNonTribute: 0,
    insideTravelBoundary: 0,
    preferenceEligible: 0,
    selectedEvents: 0,
    rejected: emptyRejectedCounts()
  };
  funnel.rejected.duplicate_event = events.length - deduplicatedEvents.length;

  const ranked = deduplicatedEvents
    .map((event) => rankEvent(enrichedInput, event, now, funnel))
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
  let explorationCount = 0;
  for (const event of ranked) {
    if (results.length >= limit) {
      funnel.rejected.result_limit += 1;
      continue;
    }
    if (event.tier === "T3") {
      if (explorationCount >= MAX_EXPLORATION_RESULTS) {
        funnel.rejected.exploration_cap += 1;
        continue;
      }
      explorationCount += 1;
    }
    results.push(event);
  }
  funnel.selectedEvents = results.length;
  return { recommendations: results, funnel };
}

export function buildRecommendations(
  input: ValidationInput,
  events: NormalizedEvent[],
  options: RecommendationOptions = {}
): RankedEvent[] {
  return buildRecommendationSelection(input, events, options).recommendations;
}
