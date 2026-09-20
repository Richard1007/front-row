import type { ImportanceLevel, WeightedPreference } from "../core/types.js";
import type { GenreValue } from "../data/genres.js";
import type { ResolvedMusicBrainzArtist } from "./musicbrainz.js";

const PREFERENCE_WEIGHT: Readonly<Record<ImportanceLevel, number>> = {
  priority: 1,
  like: 0.75,
  occasional: 0.5
};

interface GenreMapping {
  genre: GenreValue;
  weight: number;
}

/**
 * Exact, reviewable mappings from MusicBrainz community metadata to the
 * product's controlled genre pool. We intentionally do not use nationality,
 * area, name script, or fuzzy substring matching.
 */
const GENRE_RULES = new Map<string, readonly GenreMapping[]>([
  ["pop", [{ genre: "Pop", weight: 1 }]],
  ["pop rock", [{ genre: "Pop", weight: 0.7 }, { genre: "Rock", weight: 0.8 }]],
  ["pop soul", [{ genre: "Pop", weight: 0.4 }, { genre: "Soul", weight: 1 }]],
  ["rock", [{ genre: "Rock", weight: 1 }]],
  ["progressive rock", [{ genre: "Rock", weight: 1 }]],
  ["art rock", [{ genre: "Rock", weight: 1 }]],
  ["indie rock", [{ genre: "Indie", weight: 1 }, { genre: "Rock", weight: 0.35 }]],
  ["folk rock", [{ genre: "Folk", weight: 1 }, { genre: "Rock", weight: 0.35 }]],
  ["jazz rock", [{ genre: "Jazz", weight: 1 }, { genre: "Rock", weight: 0.35 }]],
  ["alternative rock", [{ genre: "Alternative", weight: 1 }, { genre: "Rock", weight: 0.35 }]],
  ["r&b", [{ genre: "R&B", weight: 1 }]],
  ["rhythm and blues", [{ genre: "R&B", weight: 1 }]],
  // A specific subgenre is stronger evidence than a lone generic tag.
  ["contemporary r&b", [{ genre: "R&B", weight: 1.15 }]],
  ["hip hop", [{ genre: "Hip-Hop/Rap", weight: 1 }]],
  ["hip-hop", [{ genre: "Hip-Hop/Rap", weight: 1 }]],
  ["rap", [{ genre: "Hip-Hop/Rap", weight: 1 }]],
  ["electronic", [{ genre: "Electronic", weight: 1 }]],
  ["electronica", [{ genre: "Electronic", weight: 1 }]],
  ["electronic dance music", [{ genre: "Electronic", weight: 1 }]],
  ["alternative", [{ genre: "Alternative", weight: 1 }]],
  ["indie", [{ genre: "Indie", weight: 1 }]],
  ["jazz", [{ genre: "Jazz", weight: 1 }]],
  ["classical", [{ genre: "Classical", weight: 1 }]],
  ["country", [{ genre: "Country", weight: 1 }]],
  ["folk", [{ genre: "Folk", weight: 1 }]],
  ["blues", [{ genre: "Blues", weight: 1 }]],
  ["soul", [{ genre: "Soul", weight: 1 }]],
  ["metal", [{ genre: "Metal", weight: 1 }]],
  ["heavy metal", [{ genre: "Metal", weight: 1 }]],
  ["punk", [{ genre: "Punk", weight: 1 }]],
  ["punk rock", [{ genre: "Punk", weight: 1 }, { genre: "Rock", weight: 0.35 }]],
  ["reggae", [{ genre: "Reggae", weight: 1 }]],
  ["latin", [{ genre: "Latin", weight: 1 }]],
  ["latin music", [{ genre: "Latin", weight: 1 }]],
  ["mandopop", [{ genre: "Mandopop", weight: 0.85 }]],
  ["mando-pop", [{ genre: "Mandopop", weight: 0.85 }]],
  ["cantopop", [{ genre: "Cantopop", weight: 0.85 }]],
  ["canto-pop", [{ genre: "Cantopop", weight: 0.85 }]],
  ["k-pop", [{ genre: "K-Pop", weight: 0.9 }]],
  ["korean pop", [{ genre: "K-Pop", weight: 0.9 }]],
  ["j-pop", [{ genre: "J-Pop", weight: 0.9 }]],
  ["japanese pop", [{ genre: "J-Pop", weight: 0.9 }]],
  ["world", [{ genre: "World", weight: 1 }]],
  ["world music", [{ genre: "World", weight: 1 }]]
]);

export interface ArtistGenreSignal {
  genre: GenreValue;
  /** Share of all reliable inferred genre evidence before the top-N limit. */
  percentage: number;
  confidence: number;
}

export interface ArtistGenreEvidence {
  artistName: string;
  status: "known" | "unknown";
  musicBrainzId?: string;
  terms: Array<{
    term: string;
    source: "musicbrainz-genre" | "musicbrainz-tag";
    mappedGenres: GenreValue[];
  }>;
}

export interface ArtistGenreInferenceResult {
  signals: ArtistGenreSignal[];
  evidence: ArtistGenreEvidence[];
  unknownArtistNames: string[];
}

export interface ResolvedArtistPreference {
  preference: WeightedPreference;
  artist?: ResolvedMusicBrainzArtist;
}

export interface ArtistGenreInferenceDependencies {
  resolveArtist: (name: string) => Promise<ResolvedMusicBrainzArtist | undefined>;
  maxSignals?: number;
}

/** Resolves metadata when it is not already available, then delegates to the pure inference step. */
export async function inferArtistGenres(
  artists: readonly WeightedPreference[],
  dependencies: ArtistGenreInferenceDependencies
): Promise<ArtistGenreInferenceResult> {
  const resolved: ResolvedArtistPreference[] = [];
  for (const preference of artists) {
    let artist: ResolvedMusicBrainzArtist | undefined;
    try {
      artist = await dependencies.resolveArtist(preference.name);
    } catch {
      artist = undefined;
    }
    resolved.push({ preference, artist });
  }
  return inferArtistGenresFromResolved(resolved, dependencies.maxSignals);
}

/**
 * Pure variant for callers that already resolved MusicBrainz metadata for
 * language inference or artist expansion, avoiding any additional request.
 */
export function inferArtistGenresFromResolved(
  artists: readonly ResolvedArtistPreference[],
  maxSignals = 3
): ArtistGenreInferenceResult {
  const totals = new Map<GenreValue, number>();
  const confidenceTotals = new Map<GenreValue, number>();
  const evidence: ArtistGenreEvidence[] = [];
  const unknownArtistNames: string[] = [];

  for (const { preference, artist } of artists) {
    const terms = mappedTerms(artist);
    if (!artist || terms.length === 0) {
      unknownArtistNames.push(preference.name);
      evidence.push({
        artistName: preference.name,
        status: "unknown",
        ...(artist ? { musicBrainzId: artist.id } : {}),
        terms: []
      });
      continue;
    }

    const perArtist = new Map<GenreValue, number>();
    const perArtistConfidence = new Map<GenreValue, number>();
    for (const term of terms) {
      const rule = GENRE_RULES.get(normalizeTerm(term.term));
      if (!rule) continue;
      const sourceConfidence = term.source === "musicbrainz-genre" ? 1 : 0.85;
      for (const mapping of rule) {
        perArtist.set(mapping.genre, (perArtist.get(mapping.genre) ?? 0) + mapping.weight);
        perArtistConfidence.set(
          mapping.genre,
          Math.max(perArtistConfidence.get(mapping.genre) ?? 0, sourceConfidence)
        );
      }
    }

    const artistTotal = [...perArtist.values()].reduce((sum, value) => sum + value, 0);
    if (artistTotal <= 0) {
      unknownArtistNames.push(preference.name);
      evidence.push({
        artistName: preference.name,
        status: "unknown",
        musicBrainzId: artist.id,
        terms: []
      });
      continue;
    }

    const preferenceWeight = PREFERENCE_WEIGHT[preference.weight];
    for (const [genre, value] of perArtist) {
      const contribution = preferenceWeight * (value / artistTotal);
      totals.set(genre, (totals.get(genre) ?? 0) + contribution);
      confidenceTotals.set(
        genre,
        (confidenceTotals.get(genre) ?? 0) +
          contribution * (perArtistConfidence.get(genre) ?? 0.85)
      );
    }
    evidence.push({
      artistName: preference.name,
      status: "known",
      musicBrainzId: artist.id,
      terms
    });
  }

  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const limit = Math.max(0, Math.floor(maxSignals));
  const signals = [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([genre, value]) => ({
      genre,
      percentage: total === 0 ? 0 : roundOneDecimal((value / total) * 100),
      confidence: roundTwoDecimals((confidenceTotals.get(genre) ?? 0) / value)
    }));

  return { signals, evidence, unknownArtistNames };
}

function mappedTerms(artist: ResolvedMusicBrainzArtist | undefined): ArtistGenreEvidence["terms"] {
  if (!artist) return [];
  const result = new Map<string, ArtistGenreEvidence["terms"][number]>();
  for (const term of artist.genres ?? []) {
    const normalized = normalizeTerm(term);
    const rule = GENRE_RULES.get(normalized);
    if (!rule) continue;
    result.set(normalized, {
      term,
      source: "musicbrainz-genre",
      mappedGenres: rule.map((mapping) => mapping.genre)
    });
  }
  for (const term of artist.tags ?? []) {
    const normalized = normalizeTerm(term);
    if (result.has(normalized)) continue;
    const rule = GENRE_RULES.get(normalized);
    if (!rule) continue;
    result.set(normalized, {
      term,
      source: "musicbrainz-tag",
      mappedGenres: rule.map((mapping) => mapping.genre)
    });
  }
  return [...result.values()];
}

function normalizeTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").trim().replace(/\s+/g, " ");
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
