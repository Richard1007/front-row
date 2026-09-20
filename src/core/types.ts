export type ImportanceLevel = "priority" | "like" | "occasional";
export type ProviderId = "ticketmaster" | "jambase" | "stubhub" | "fixture";
export type ProviderMode = "live" | "fixture" | "disabled" | "unconfigured";
export type RecommendationTier = "T0" | "T1" | "T2" | "T3";
export type EventStatus = "active" | "cancelled" | "postponed" | "unknown";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface WeightedPreference {
  name: string;
  weight: ImportanceLevel;
  /** Stable provider-neutral identity when the user selected a resolved artist. */
  canonicalId?: string;
  /** Confirmed spelling variants; imported candidates must not populate this implicitly. */
  aliases?: string[];
}

export interface LanguagePreference {
  language: string;
  percentage: number;
}

export interface ValidationInput {
  artists: WeightedPreference[];
  /** Server-side sourced related artists used only for candidate retrieval. */
  discoveryArtists?: ArtistExpansionCandidate[];
  genres: WeightedPreference[];
  languages: LanguagePreference[];
  languageMode: "weighted" | "any";
  origin: Coordinates & { label: string };
  maxTravelMinutes: number;
  forecastMonths?: number;
}

export interface Performer {
  name: string;
  canonicalId?: string;
  role?: "headliner" | "co-headliner" | "support" | "festival" | "unknown";
  /** Optional, sourced relationship to one of the user's selected artists. */
  similarTo?: ArtistSimilarityEvidence[];
}

export interface ArtistSimilarityEvidence {
  preferenceName?: string;
  preferenceCanonicalId?: string;
  score: number;
  confidence: number;
  source: "manual" | "provider" | "genre" | "listenbrainz";
}

/** A related artist backed by an external discovery source, not an invented event. */
export interface ArtistExpansionCandidate {
  name: string;
  aliases?: string[];
  canonicalId: string;
  musicBrainzId: string;
  evidence: ArtistExpansionEvidence[];
}

export interface ArtistExpansionEvidence {
  source: "listenbrainz";
  seedName: string;
  seedCanonicalId?: string;
  seedWeight: ImportanceLevel;
  rank: number;
}

export interface EventSource {
  provider: ProviderId;
  eventId: string;
  url?: string;
  fetchedAt: string;
  mode: "live" | "fixture";
}

export interface LanguageEvidence {
  language: string;
  role: "primary" | "significant" | "occasional";
  confidence: number;
  source: "manual" | "provider" | "unknown";
}

export interface NormalizedEvent {
  canonicalKey: string;
  name: string;
  startAt: string;
  status: EventStatus;
  venue: {
    name: string;
    city?: string;
    region?: string;
    coordinates?: Coordinates;
  };
  performers: Performer[];
  genres: string[];
  languages: LanguageEvidence[];
  sources: EventSource[];
  isTribute?: boolean;
  onSaleAt?: string;
  notes?: string[];
}

export interface ScoreBreakdown {
  artist?: number;
  genre?: number;
  language?: number;
  coverage: number;
  final: number;
}

export interface RankedEvent extends NormalizedEvent {
  tier: RecommendationTier;
  score: ScoreBreakdown;
  reason: string;
  estimatedTravelMinutes?: number;
  distanceMiles?: number;
  warnings: string[];
}

export interface ProviderCapability {
  id: ProviderId;
  label: string;
  mode: ProviderMode;
  message: string;
}

export interface ProviderDiagnostic {
  provider: ProviderId;
  mode: ProviderMode;
  status: "success" | "failed" | "skipped";
  eventCount: number;
  message?: string;
}

export interface ValidationResult {
  runId: string;
  generatedAt: string;
  dataMode: "live" | "fixture" | "mixed" | "unavailable";
  recommendations: RankedEvent[];
  diagnostics: ProviderDiagnostic[];
  discovery?: {
    source: "musicbrainz-listenbrainz";
    candidateArtists: string[];
    unresolvedSeeds: string[];
  };
  coverage: {
    rawEvents: number;
    deduplicatedEvents: number;
    eligibleEvents: number;
  };
}
