import { normalizeArtistName } from "../data/artistProfiles.js";
import type {
  ArtistExpansionCandidate,
  ArtistSimilarityEvidence,
  NormalizedEvent
} from "../core/types.js";

const MIN_SIMILARITY = 0.5;
const MAX_SIMILARITY = 0.85;

function evidenceFor(candidate: ArtistExpansionCandidate): ArtistSimilarityEvidence[] {
  return candidate.evidence.map((evidence) => {
    if (evidence.source === "openai") {
      return {
        preferenceName: evidence.seedName,
        preferenceCanonicalId: evidence.seedCanonicalId,
        score: Math.max(0.45, 0.55 - (evidence.rank - 1) * 0.02),
        confidence: Math.min(1, Math.max(0, evidence.confidence ?? 0)),
        source: "openai" as const,
        rationale: evidence.rationale,
        microgenres: evidence.microgenres
      };
    }
    return {
      preferenceName: evidence.seedName,
      preferenceCanonicalId: evidence.seedCanonicalId,
      score: Math.max(MIN_SIMILARITY, MAX_SIMILARITY - (evidence.rank - 1) * 0.04),
      confidence: 0.75,
      source: "listenbrainz" as const
    };
  });
}

/** Attaches sourced similarity only when a ticket provider confirms the performer. */
export function applyExpansionEvidence(
  events: readonly NormalizedEvent[],
  candidates: readonly ArtistExpansionCandidate[]
): NormalizedEvent[] {
  const candidatesByName = new Map<string, ArtistExpansionCandidate>();
  for (const candidate of candidates) {
    for (const name of [candidate.name, ...(candidate.aliases ?? [])]) {
      candidatesByName.set(normalizeArtistName(name), candidate);
    }
  }

  return events.map((event) => ({
    ...event,
    performers: event.performers.map((performer) => {
      const candidate = candidatesByName.get(normalizeArtistName(performer.name));
      if (!candidate) return performer;
      return {
        ...performer,
        canonicalId: candidate.canonicalId,
        similarTo: [...(performer.similarTo ?? []), ...evidenceFor(candidate)]
      };
    })
  }));
}
