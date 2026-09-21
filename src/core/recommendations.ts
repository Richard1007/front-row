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
const DEFAULT_RESULT_LIMIT = 9;
const MAX_RESULT_LIMIT = 9;
const ABSOLUTE_RESULT_LIMIT = 10;
const MAX_EXPLORATION_RESULTS = 5;
const MINIMUM_USEFUL_RESULTS = 3;

export interface RecommendationOptions {
  now?: Date;
  limit?: number;
}

interface DimensionValue {
  match: number;
  confidence: number;
  label?: string;
  similaritySource?: ArtistSimilarityEvidence["source"];
  rationale?: string;
  preferenceSource?: "explicit" | "inferred";
}

export interface RecommendationSelection {
  recommendations: RankedEvent[];
  funnel: RecommendationFunnel;
}

export interface RecommendationCandidatePool {
  /** Every deduplicated, date/travel/status/preference-eligible event before list limits. */
  candidates: RankedEvent[];
  /** Structurally safe live events without enough evidence for a strong preference match. */
  fallbackCandidates: RankedEvent[];
  funnel: RecommendationFunnel;
  resultLimit: number;
}

interface RankedCandidate {
  event: RankedEvent;
  preferenceEligible: boolean;
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
          openai: 0.55,
          genre: 0.45
        };
        const match =
          Math.min(clampUnit(affinity.score), sourceCeiling[affinity.source]) *
          IMPORTANCE_VALUES[preference.weight];
        const candidate = {
          match,
          confidence: clampUnit(affinity.confidence),
          label: preference.name,
          similaritySource: affinity.source,
          rationale: affinity.rationale
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
  similaritySource: ArtistSimilarityEvidence["source"] | undefined,
  now: Date
): RecommendationTier {
  if (exact) {
    const futureOnSale = event.onSaleAt ? Date.parse(event.onSaleAt) > now.getTime() : false;
    if (futureOnSale) return "T0";
    return "T1";
  }
  return hasSourcedArtistSimilarity && similaritySource !== "openai" ? "T2" : "T3";
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
  else if (dimensions.artist?.label) {
    reasons.push(
      dimensions.artist.similaritySource === "openai" && dimensions.artist.rationale
        ? `AI 根据 ${dimensions.artist.label} 推断：${dimensions.artist.rationale}`
        : `与 ${dimensions.artist.label} 风格相近`
    );
  }

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
): RankedCandidate | undefined {
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
  const preferenceEligible = Boolean(
    exact || hasSourcedArtistSimilarity || hasGenreAffinity || hasLanguageAffinity
  );
  if (preferenceEligible) funnel.preferenceEligible += 1;

  const tier = tierFor(
    event,
    exact,
    hasSourcedArtistSimilarity,
    dimensions.artist?.similaritySource,
    now
  );

  return {
    preferenceEligible,
    event: {
      ...event,
      tier: preferenceEligible ? tier : "T3",
      isFallback: preferenceEligible ? undefined : true,
      score: {
        artist: dimensions.artist?.match,
        genre: dimensions.genre?.match,
        language: dimensions.language?.match,
        coverage: aggregate.coverage,
        final: aggregate.final
      },
      reason: preferenceEligible
        ? reasonFor(tier, exact, dimensions, event)
        : "在你的出行范围内，作为少量探索推荐",
      estimatedTravelMinutes: travel.travelMinutes,
      distanceMiles: travel.distanceMiles,
      warnings: preferenceEligible
        ? warningsFor(event, input)
        : [
            "没有找到可靠的偏好匹配。这是经过验证的附近演出，不代表强匹配",
            ...warningsFor(event, input)
          ]
    }
  };
}

function rankedDisplayOrder(left: RankedEvent, right: RankedEvent): number {
  const fallbackDifference = Number(Boolean(left.isFallback)) - Number(Boolean(right.isFallback));
  if (fallbackDifference !== 0) return fallbackDifference;
  const tierDifference = TIER_ORDER[left.tier] - TIER_ORDER[right.tier];
  if (tierDifference !== 0) return tierDifference;
  const scoreDifference = right.score.final - left.score.final;
  if (scoreDifference !== 0) return scoreDifference;
  const dateDifference = Date.parse(left.startAt) - Date.parse(right.startAt);
  if (dateDifference !== 0) return dateDifference;
  return left.canonicalKey.localeCompare(right.canonicalKey);
}

function fallbackDisplayOrder(left: RankedEvent, right: RankedEvent): number {
  const distanceDifference = (left.distanceMiles ?? Infinity) - (right.distanceMiles ?? Infinity);
  if (distanceDifference !== 0) return distanceDifference;
  const dateDifference = Date.parse(left.startAt) - Date.parse(right.startAt);
  if (dateDifference !== 0) return dateDifference;
  return left.canonicalKey.localeCompare(right.canonicalKey);
}

function exactPreferenceKey(preference: WeightedPreference): string {
  return preference.canonicalId ?? normalizedText(preference.name);
}

interface ExactSelectionCandidate {
  event: RankedEvent;
  preference: WeightedPreference;
}

function exactSelectionOrder(
  left: ExactSelectionCandidate,
  right: ExactSelectionCandidate
): number {
  const importanceDifference =
    IMPORTANCE_VALUES[right.preference.weight] - IMPORTANCE_VALUES[left.preference.weight];
  if (importanceDifference !== 0) return importanceDifference;
  const dateDifference = Date.parse(left.event.startAt) - Date.parse(right.event.startAt);
  if (dateDifference !== 0) return dateDifference;
  const scoreDifference = right.event.score.final - left.event.score.final;
  if (scoreDifference !== 0) return scoreDifference;
  return left.event.canonicalKey.localeCompare(right.event.canonicalKey);
}

/**
 * Protects one show per explicitly selected artist before allocating remaining
 * exact-artist slots. When there are more artists than slots, importance and
 * event date provide deterministic prioritization.
 */
function selectExactEvents(
  events: RankedEvent[],
  preferences: WeightedPreference[],
  limit: number
): RankedEvent[] {
  const candidates = events
    .map((event) => {
      const exact = exactArtistMatch(event, preferences);
      return exact ? { event, preference: exact.preference } : undefined;
    })
    .filter((candidate): candidate is ExactSelectionCandidate => Boolean(candidate))
    .sort(exactSelectionOrder);
  if (candidates.length <= limit) return candidates.map((candidate) => candidate.event);

  const selected: ExactSelectionCandidate[] = [];
  const selectedKeys = new Set<string>();
  const selectedEvents = new Set<string>();
  for (const candidate of candidates) {
    const preferenceKey = exactPreferenceKey(candidate.preference);
    if (selectedKeys.has(preferenceKey)) continue;
    selected.push(candidate);
    selectedKeys.add(preferenceKey);
    selectedEvents.add(candidate.event.canonicalKey);
    if (selected.length >= limit) return selected.map((item) => item.event);
  }

  for (const candidate of candidates) {
    if (selectedEvents.has(candidate.event.canonicalKey)) continue;
    selected.push(candidate);
    selectedEvents.add(candidate.event.canonicalKey);
    if (selected.length >= limit) break;
  }
  return selected.map((candidate) => candidate.event);
}

function primaryPerformerKey(event: RankedEvent): string {
  const performer =
    event.performers.find((item) => item.role === "headliner") ?? event.performers[0];
  if (!performer) return event.canonicalKey;
  return performer.canonicalId ?? normalizedText(performer.name);
}

/** Preserve quality order while separating each performer's first show from repeats. */
function partitionPerformerRepeats(
  events: RankedEvent[],
  initiallySeen: ReadonlySet<string> = new Set()
): { firstByPerformer: RankedEvent[]; repeats: RankedEvent[] } {
  const firstByPerformer: RankedEvent[] = [];
  const repeats: RankedEvent[] = [];
  const seen = new Set(initiallySeen);
  for (const event of events) {
    const key = primaryPerformerKey(event);
    if (seen.has(key)) repeats.push(event);
    else {
      seen.add(key);
      firstByPerformer.push(event);
    }
  }
  return { firstByPerformer, repeats };
}

/**
 * Builds the complete verified candidate pool before digest limits and discovery
 * caps are applied. This is the safe boundary for an optional reranker: every
 * candidate has already passed provider-neutral eligibility checks.
 */
export function buildRecommendationCandidatePool(
  input: ValidationInput,
  events: NormalizedEvent[],
  options: RecommendationOptions = {}
): RecommendationCandidatePool {
  const now = options.now ?? new Date();
  const hasExplicitLimit = Number.isFinite(options.limit);
  const requestedLimit = hasExplicitLimit
    ? Math.floor(options.limit!)
    : DEFAULT_RESULT_LIMIT;
  const normalLimit = Math.min(MAX_RESULT_LIMIT, Math.max(1, requestedLimit));
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
    fallbackEligible: 0,
    fallbackSelected: 0,
    selectedEvents: 0,
    rejected: emptyRejectedCounts()
  };
  funnel.rejected.duplicate_event = events.length - deduplicatedEvents.length;

  const classified = deduplicatedEvents
    .map((event) => rankEvent(enrichedInput, event, now, funnel))
    .filter((event): event is RankedCandidate => Boolean(event));
  const ranked = classified
    .filter((candidate) => candidate.preferenceEligible)
    .map((candidate) => candidate.event)
    .sort(rankedDisplayOrder);
  const weakCandidates = classified.filter((candidate) => !candidate.preferenceEligible);
  const fallbackCandidates = weakCandidates
    .filter((candidate) => candidate.event.sources.some((source) => source.mode === "live"))
    .map((candidate) => candidate.event)
    .sort(fallbackDisplayOrder);
  funnel.fallbackEligible = fallbackCandidates.length;
  funnel.rejected.no_preference_affinity = weakCandidates.length;

  const exact = ranked.filter((event) => event.tier === "T0" || event.tier === "T1");
  const exactArtistKeys = new Set(
    exact
      .map((event) => exactArtistMatch(event, enrichedInput.artists)?.preference)
      .filter((preference): preference is WeightedPreference => Boolean(preference))
      .map(exactPreferenceKey)
  );
  // The normal digest stays below ten. The only exception protects one show
  // for each of ten explicitly selected artists when all ten have an eligible
  // event and the caller did not request a smaller custom limit.
  const limit =
    !hasExplicitLimit &&
    enrichedInput.artists.length >= ABSOLUTE_RESULT_LIMIT &&
    exactArtistKeys.size >= ABSOLUTE_RESULT_LIMIT
      ? ABSOLUTE_RESULT_LIMIT
      : normalLimit;

  return { candidates: ranked, fallbackCandidates, funnel, resultLimit: limit };
}

/**
 * Provider-neutral recommendation pipeline: deduplicate, filter, score, explain,
 * and normally return fewer than ten strong events. Every T0/T1 result precedes discovery.
 */
export function buildRecommendationSelection(
  input: ValidationInput,
  events: NormalizedEvent[],
  options: RecommendationOptions = {}
): RecommendationSelection {
  const pool = buildRecommendationCandidatePool(input, events, options);
  const ranked = pool.candidates;
  const funnel = pool.funnel;
  const limit = pool.resultLimit;
  const enrichedInput = enrichValidationInput(input);
  const exact = ranked.filter((event) => event.tier === "T0" || event.tier === "T1");
  const selectedExact = selectExactEvents(exact, enrichedInput.artists, limit);
  funnel.rejected.result_limit += exact.length - selectedExact.length;

  const results: RankedEvent[] = [...selectedExact];
  const discovery = partitionPerformerRepeats(
    ranked.filter((event) => event.tier === "T2" || event.tier === "T3")
  );
  let explorationCount = 0;
  const addDiscovery = (event: RankedEvent): boolean => {
    if (results.length >= limit) {
      funnel.rejected.result_limit += 1;
      return false;
    }
    if (event.tier === "T3" && explorationCount >= MAX_EXPLORATION_RESULTS) {
      funnel.rejected.exploration_cap += 1;
      return false;
    }
    results.push(event);
    if (event.tier === "T3") explorationCount += 1;
    return true;
  };

  // Strong discovery results first represent each performer only once. Repeat
  // dates are deferred so a single touring artist cannot crowd out a more
  // useful nearby shortlist.
  for (const event of discovery.firstByPerformer) {
    addDiscovery(event);
  }

  // A sparse digest is not useful. If strong matches do not fill three places,
  // prefer verified nearby events from different performers before allowing a
  // second date from the same discovery performer.
  const minimumResults = Math.min(limit, MINIMUM_USEFUL_RESULTS);
  const selectedPerformerKeys = new Set(results.map(primaryPerformerKey));
  const fallback = partitionPerformerRepeats(
    pool.fallbackCandidates,
    selectedPerformerKeys
  );
  let selectedFallbacks = 0;
  for (const event of fallback.firstByPerformer) {
    if (results.length >= minimumResults) break;
    results.push(event);
    selectedPerformerKeys.add(primaryPerformerKey(event));
    selectedFallbacks += 1;
  }

  // Only use repeated discovery dates when distinct, verified nearby options
  // still cannot produce the minimum useful digest.
  for (const event of discovery.repeats) {
    if (results.length >= minimumResults) break;
    addDiscovery(event);
  }

  // A repeated fallback is the final safe option when the regional catalog is
  // itself concentrated around one performer.
  for (const event of fallback.repeats) {
    if (results.length >= minimumResults) break;
    results.push(event);
    selectedFallbacks += 1;
  }
  funnel.fallbackSelected = selectedFallbacks;
  funnel.rejected.no_preference_affinity = Math.max(
    0,
    funnel.rejected.no_preference_affinity - selectedFallbacks
  );
  results.sort(rankedDisplayOrder);
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
