import type { WeightedPreference } from "../core/types.js";
import { normalizeArtistName } from "../data/artistProfiles.js";
import type {
  MusicBrainzArtistDetails,
  ResolvedMusicBrainzArtist
} from "./musicbrainz.js";

export interface ExplicitArtistHydrationDependencies {
  resolveArtist: (name: string) => Promise<ResolvedMusicBrainzArtist | undefined>;
  artistDetails: (musicBrainzId: string) => Promise<MusicBrainzArtistDetails | undefined>;
}

/**
 * Adds a provider-neutral MusicBrainz identity and confirmed aliases while
 * preserving the user's original display name. Failures are isolated per
 * artist so metadata availability can never block event retrieval.
 */
export async function hydrateExplicitArtists(
  artists: readonly WeightedPreference[],
  dependencies: ExplicitArtistHydrationDependencies
): Promise<WeightedPreference[]> {
  return Promise.all(
    artists.map(async (preference) => {
      let resolved: ResolvedMusicBrainzArtist | undefined;
      try {
        resolved = await dependencies.resolveArtist(preference.name);
      } catch {
        return preference;
      }
      if (!resolved) return preference;

      let details: MusicBrainzArtistDetails | undefined;
      try {
        details = await dependencies.artistDetails(resolved.id);
      } catch {
        details = undefined;
      }
      // A mismatched lookup payload is not confirmed evidence for this seed.
      if (details?.id !== resolved.id) details = undefined;

      return {
        ...preference,
        canonicalId: `musicbrainz:${resolved.id}`,
        aliases: confirmedAliases(preference, resolved, details)
      };
    })
  );
}

function confirmedAliases(
  preference: WeightedPreference,
  resolved: ResolvedMusicBrainzArtist,
  details: MusicBrainzArtistDetails | undefined
): string[] {
  const displayName = normalizeArtistName(preference.name);
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const candidate of [
    ...(preference.aliases ?? []),
    resolved.name,
    details?.name,
    ...(details?.aliases ?? [])
  ]) {
    const value = candidate?.trim();
    if (!value) continue;
    const normalized = normalizeArtistName(value);
    if (!normalized || normalized === displayName || seen.has(normalized)) continue;
    seen.add(normalized);
    aliases.push(value);
  }
  return aliases;
}
