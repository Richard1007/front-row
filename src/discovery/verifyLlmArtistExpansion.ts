import type {
  ArtistExpansionCandidate,
  WeightedPreference
} from "../core/types.js";
import type { LlmArtistExpansionCandidate } from "./llmArtistExpansion.js";
import type { ResolvedMusicBrainzArtist } from "./musicbrainz.js";

const MAX_VERIFIED_CANDIDATES = 12;
const MAX_VERIFICATION_ATTEMPTS = 20;

export interface VerifyLlmArtistExpansionOptions {
  resolveArtist: (name: string) => Promise<ResolvedMusicBrainzArtist | undefined>;
  maxCandidates?: number;
  maxVerificationAttempts?: number;
  existingCandidates?: readonly ArtistExpansionCandidate[];
}

/**
 * Converts model suggestions into provider-search candidates only after a
 * high-confidence MusicBrainz identity check. The model never creates events.
 */
export async function verifyLlmArtistExpansion(
  suggestions: readonly LlmArtistExpansionCandidate[],
  preferences: readonly WeightedPreference[],
  options: VerifyLlmArtistExpansionOptions
): Promise<ArtistExpansionCandidate[]> {
  const maxCandidates = Math.min(
    MAX_VERIFIED_CANDIDATES,
    Math.max(0, Math.floor(options.maxCandidates ?? MAX_VERIFIED_CANDIDATES))
  );
  const maxAttempts = Math.min(
    MAX_VERIFICATION_ATTEMPTS,
    Math.max(
      maxCandidates,
      Math.floor(options.maxVerificationAttempts ?? MAX_VERIFICATION_ATTEMPTS)
    )
  );
  const selectedNames = new Set(
    preferences.flatMap((artist) => [artist.name, ...(artist.aliases ?? [])]).map(normalizeName)
  );
  const preferencesByName = new Map<string, WeightedPreference>();
  for (const preference of preferences) {
    for (const name of [preference.name, ...(preference.aliases ?? [])]) {
      preferencesByName.set(normalizeName(name), preference);
    }
  }
  const seenNames = new Set(selectedNames);
  const seenCanonicalIds = new Set([
    ...preferences
      .map((preference) => preference.canonicalId)
      .filter((canonicalId): canonicalId is string => Boolean(canonicalId)),
    ...(options.existingCandidates?.map((candidate) => candidate.canonicalId) ?? [])
  ]);
  for (const candidate of options.existingCandidates ?? []) {
    for (const name of [candidate.name, ...(candidate.aliases ?? [])]) {
      seenNames.add(normalizeName(name));
    }
  }

  const verified: ArtistExpansionCandidate[] = [];
  let attempts = 0;
  for (const suggestion of suggestions) {
    if (verified.length >= maxCandidates || attempts >= maxAttempts) break;
    const normalizedSuggestion = normalizeName(suggestion.name);
    if (!normalizedSuggestion || seenNames.has(normalizedSuggestion)) continue;
    if (suggestion.confidence < 0.7) continue;
    seenNames.add(normalizedSuggestion);
    attempts += 1;

    let resolved: ResolvedMusicBrainzArtist | undefined;
    try {
      resolved = await options.resolveArtist(suggestion.name);
    } catch {
      continue;
    }
    if (!resolved) continue;
    const canonicalId = `musicbrainz:${resolved.id}`;
    if (seenCanonicalIds.has(canonicalId)) continue;
    seenCanonicalIds.add(canonicalId);

    const relatedPreferences = suggestion.relatedTo
      .map((name) => preferencesByName.get(normalizeName(name)))
      .filter((artist): artist is WeightedPreference => Boolean(artist));
    const evidencePreferences = relatedPreferences.length > 0
      ? relatedPreferences
      : preferences.slice(0, 1);
    if (evidencePreferences.length === 0) continue;

    verified.push({
      name: resolved.name,
      aliases: resolved.name === suggestion.name ? undefined : [suggestion.name],
      canonicalId,
      musicBrainzId: resolved.id,
      evidence: evidencePreferences.map((artist) => ({
        source: "openai" as const,
        seedName: artist.name,
        seedCanonicalId: artist.canonicalId,
        seedWeight: artist.weight,
        rank: verified.length + 1,
        confidence: suggestion.confidence,
        rationale: suggestion.rationale,
        microgenres: suggestion.microgenres
      }))
    });
  }
  return verified;
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").trim().replace(/\s+/g, " ");
}
