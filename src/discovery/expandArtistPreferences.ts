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

const ALLOCATION_CREDITS: Readonly<Record<ImportanceLevel, number>> = {
  priority: 3,
  like: 2,
  occasional: 1
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

  const seeds: Array<{
    artist: WeightedPreference;
    related: ListenBrainzSimilarArtist[];
    cursor: number;
    candidateCount: number;
  }> = [];
  const terminalDiagnostics: ArtistExpansionDiagnostic[] = [];

  for (const { artist } of orderedSeeds) {
    const seedLimit = Math.max(0, Math.floor(perSeedLimits[artist.weight]));
    if (seedLimit === 0) {
      terminalDiagnostics.push({ seedName: artist.name, status: "expanded", candidateCount: 0 });
      continue;
    }

    try {
      const resolved = await dependencies.resolveArtist(artist.name);
      if (!resolved) {
        terminalDiagnostics.push({ seedName: artist.name, status: "unresolved", candidateCount: 0 });
        continue;
      }
      const similar = await dependencies.similarArtists(resolved.id, seedLimit);
      seeds.push({
        artist,
        related: similar
          .slice(0, seedLimit)
          .filter(
            (related) =>
              related.id !== resolved.id && !selectedNames.has(normalizeName(related.name))
          ),
        cursor: 0,
        candidateCount: 0
      });
    } catch {
      terminalDiagnostics.push({ seedName: artist.name, status: "failed", candidateCount: 0 });
    }
  }

  // Weighted round-robin prevents the first seed from consuming the entire
  // global budget while still giving stronger preferences more opportunities.
  const maxCredits = Math.max(...Object.values(ALLOCATION_CREDITS));
  let madeProgress = true;
  while (candidates.size < maxCandidates && madeProgress) {
    madeProgress = false;
    for (let credit = 0; credit < maxCredits && candidates.size < maxCandidates; credit += 1) {
      for (const seed of seeds) {
        if (candidates.size >= maxCandidates) break;
        if (ALLOCATION_CREDITS[seed.artist.weight] <= credit) continue;
        const related = seed.related[seed.cursor];
        if (!related) continue;
        seed.cursor += 1;
        madeProgress = true;

        const canonicalId = `musicbrainz:${related.id}`;
        const evidence = {
          source: "listenbrainz" as const,
          seedName: seed.artist.name,
          seedCanonicalId: seed.artist.canonicalId,
          seedWeight: seed.artist.weight,
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
        seed.candidateCount += 1;
      }
    }
  }

  const diagnostics = [
    ...seeds.map((seed) => ({
      seedName: seed.artist.name,
      status: "expanded" as const,
      candidateCount: seed.candidateCount
    })),
    ...terminalDiagnostics
  ].sort(
    (left, right) =>
      inputArtists.findIndex((artist) => artist.name === left.seedName) -
      inputArtists.findIndex((artist) => artist.name === right.seedName)
  );

  return { candidates: [...candidates.values()], diagnostics };
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").trim().replace(/\s+/g, " ");
}
