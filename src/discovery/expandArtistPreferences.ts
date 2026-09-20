import type {
  ArtistExpansionCandidate,
  ImportanceLevel,
  WeightedPreference
} from "../core/types.js";
import type { ListenBrainzSimilarArtist } from "./listenbrainz.js";
import type { ResolvedMusicBrainzArtist } from "./musicbrainz.js";

const DEFAULT_PER_SEED_LIMITS: Readonly<Record<ImportanceLevel, number>> = {
  priority: 8,
  like: 5,
  occasional: 3
};

const WEIGHT_ORDER: Readonly<Record<ImportanceLevel, number>> = {
  priority: 0,
  like: 1,
  occasional: 2
};

export interface ArtistExpansionDependencies {
  resolveArtist: (name: string) => Promise<ResolvedMusicBrainzArtist | undefined>;
  similarArtists: (
    musicBrainzId: string,
    limit: number
  ) => Promise<ListenBrainzSimilarArtist[]>;
  maxCandidates?: number;
  perSeedLimits?: Partial<Record<ImportanceLevel, number>>;
}

export interface ArtistExpansionDiagnostic {
  seedName: string;
  status: "expanded" | "unresolved" | "failed";
  candidateCount: number;
}

export interface ArtistExpansionResult {
  candidates: ArtistExpansionCandidate[];
  diagnostics: ArtistExpansionDiagnostic[];
}

/**
 * Expands explicit preferences into externally sourced artist candidates.
 * It is deliberately event-agnostic: ticketing providers remain the only
 * authority for whether a real concert exists.
 */
export async function expandArtistPreferences(
  inputArtists: readonly WeightedPreference[],
  dependencies: ArtistExpansionDependencies
): Promise<ArtistExpansionResult> {
  const maxCandidates = Math.max(0, Math.floor(dependencies.maxCandidates ?? 20));
  const perSeedLimits = { ...DEFAULT_PER_SEED_LIMITS, ...dependencies.perSeedLimits };
  const candidates = new Map<string, ArtistExpansionCandidate>();
  const diagnostics: ArtistExpansionDiagnostic[] = [];
  const selectedNames = new Set(
    inputArtists.flatMap((artist) => [artist.name, ...(artist.aliases ?? [])]).map(normalizeName)
  );

  const orderedSeeds = inputArtists
    .map((artist, index) => ({ artist, index }))
    .sort(
      (left, right) =>
        WEIGHT_ORDER[left.artist.weight] - WEIGHT_ORDER[right.artist.weight] ||
        left.index - right.index
    );

  for (const { artist } of orderedSeeds) {
    if (candidates.size >= maxCandidates) break;
    const seedLimit = Math.max(0, Math.floor(perSeedLimits[artist.weight]));
    if (seedLimit === 0) {
      diagnostics.push({ seedName: artist.name, status: "expanded", candidateCount: 0 });
      continue;
    }

    try {
      const resolved = await dependencies.resolveArtist(artist.name);
      if (!resolved) {
        diagnostics.push({ seedName: artist.name, status: "unresolved", candidateCount: 0 });
        continue;
      }
      const similar = await dependencies.similarArtists(resolved.id, seedLimit);
      let added = 0;
      for (const related of similar.slice(0, seedLimit)) {
        if (candidates.size >= maxCandidates) break;
        if (related.id === resolved.id || selectedNames.has(normalizeName(related.name))) continue;
        const canonicalId = `musicbrainz:${related.id}`;
        const evidence = {
          source: "listenbrainz" as const,
          seedName: artist.name,
          seedCanonicalId: artist.canonicalId,
          seedWeight: artist.weight,
          rank: related.rank
        };
        const existing = candidates.get(canonicalId);
        if (existing) {
          existing.evidence.push(evidence);
          continue;
        }
        candidates.set(canonicalId, {
          name: related.name,
          canonicalId,
          musicBrainzId: related.id,
          evidence: [evidence]
        });
        added += 1;
      }
      diagnostics.push({ seedName: artist.name, status: "expanded", candidateCount: added });
    } catch {
      diagnostics.push({ seedName: artist.name, status: "failed", candidateCount: 0 });
    }
  }

  return { candidates: [...candidates.values()], diagnostics };
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").trim().replace(/\s+/g, " ");
}
