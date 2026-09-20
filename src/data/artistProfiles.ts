import type { LanguageEvidence } from "../core/types.js";

export interface CuratedArtistProfile {
  canonicalId: string;
  displayName: string;
  aliases: readonly string[];
  providerIds?: Readonly<{
    ticketmaster?: string;
    jambase?: string;
  }>;
  languages: readonly LanguageEvidence[];
}

/**
 * Small, reviewable Milestone 0 dataset. It is deliberately curated rather
 * than inferred from nationality, script, popularity, or genre.
 */
export const MILESTONE_ZERO_ARTIST_PROFILES: readonly CuratedArtistProfile[] = [
  {
    canonicalId: "frontrow:artist:wang-leehom",
    displayName: "王力宏",
    aliases: ["王力宏", "Wang Leehom", "Leehom Wang", "Lee-Hom Wang"],
    providerIds: {
      ticketmaster: "K8vZ9173-Uf",
      jambase: "jambase:5911976"
    },
    languages: [
      { language: "cmn", role: "primary", confidence: 0.95, source: "manual" },
      { language: "en", role: "significant", confidence: 0.85, source: "manual" }
    ]
  },
  {
    canonicalId: "frontrow:artist:jay-chou",
    displayName: "周杰伦",
    aliases: ["周杰伦", "周杰倫", "Jay Chou", "Chou Chieh-lun"],
    providerIds: {
      ticketmaster: "K8vZ917Gknf",
      jambase: "jambase:3988227"
    },
    languages: [
      { language: "cmn", role: "primary", confidence: 0.95, source: "manual" }
    ]
  },
  {
    canonicalId: "frontrow:artist:bruno-mars",
    displayName: "Bruno Mars",
    aliases: ["Bruno Mars", "Peter Gene Hernandez", "Peter Hernandez"],
    providerIds: {
      ticketmaster: "K8vZ917GJc7",
      jambase: "jambase:276337"
    },
    languages: [
      { language: "en", role: "primary", confidence: 0.95, source: "manual" }
    ]
  }
] as const;

export function normalizeArtistName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const profilesByAlias = new Map<string, CuratedArtistProfile>();
const profilesByCanonicalId = new Map<string, CuratedArtistProfile>();
for (const profile of MILESTONE_ZERO_ARTIST_PROFILES) {
  profilesByCanonicalId.set(profile.canonicalId, profile);
  for (const alias of profile.aliases) profilesByAlias.set(normalizeArtistName(alias), profile);
}

export function findArtistProfile(
  name: string,
  canonicalId?: string
): CuratedArtistProfile | undefined {
  if (canonicalId) {
    const direct = profilesByCanonicalId.get(canonicalId);
    if (direct) return direct;
  }
  return profilesByAlias.get(normalizeArtistName(name));
}

const LANGUAGE_ALIASES = new Map<string, string>([
  ["普通话", "cmn"],
  ["普通話", "cmn"],
  ["国语", "cmn"],
  ["國語", "cmn"],
  ["mandarin", "cmn"],
  ["mandarin chinese", "cmn"],
  ["cmn", "cmn"],
  ["英语", "en"],
  ["英語", "en"],
  ["英文", "en"],
  ["english", "en"],
  ["en", "en"],
  ["粤语", "yue"],
  ["粵語", "yue"],
  ["广东话", "yue"],
  ["廣東話", "yue"],
  ["cantonese", "yue"],
  ["yue", "yue"]
]);

export function normalizeLanguageTag(value: string): string {
  const normalized = value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
  return LANGUAGE_ALIASES.get(normalized) ?? normalized;
}
