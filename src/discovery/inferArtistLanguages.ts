import type { ImportanceLevel, WeightedPreference } from "../core/types.js";
import { findArtistProfile, normalizeLanguageTag } from "../data/artistProfiles.js";
import { isLanguageValue, type LanguageValue } from "../data/languages.js";
import type { ResolvedMusicBrainzArtist } from "./musicbrainz.js";

const PREFERENCE_WEIGHT: Readonly<Record<ImportanceLevel, number>> = {
  priority: 1,
  like: 0.75,
  occasional: 0.5
};

const ROLE_WEIGHT = {
  primary: 1,
  significant: 0.5,
  occasional: 0.2
} as const;

interface TagLanguageRule {
  language: LanguageValue;
  confidence: number;
}

/**
 * Only tags that describe performance language unambiguously belong here.
 * Generic tags such as `chinese`, `latin`, `k-pop`, countries, and scripts are
 * intentionally absent because they do not prove the language of a performance.
 */
const LANGUAGE_TAG_RULES = new Map<string, TagLanguageRule>([
  ["mandopop", { language: "cmn", confidence: 0.9 }],
  ["mando-pop", { language: "cmn", confidence: 0.9 }],
  ["mandarin pop", { language: "cmn", confidence: 0.9 }],
  ["cantopop", { language: "yue", confidence: 0.9 }],
  ["canto-pop", { language: "yue", confidence: 0.9 }],
  ["cantonese pop", { language: "yue", confidence: 0.9 }],
  ["english-language", { language: "en", confidence: 0.95 }],
  ["english language", { language: "en", confidence: 0.95 }],
  ["spanish-language", { language: "es", confidence: 0.95 }],
  ["spanish language", { language: "es", confidence: 0.95 }],
  ["french-language", { language: "fr", confidence: 0.95 }],
  ["french language", { language: "fr", confidence: 0.95 }],
  ["korean-language", { language: "ko", confidence: 0.95 }],
  ["korean language", { language: "ko", confidence: 0.95 }],
  ["japanese-language", { language: "ja", confidence: 0.95 }],
  ["japanese language", { language: "ja", confidence: 0.95 }],
  ["portuguese-language", { language: "pt", confidence: 0.95 }],
  ["portuguese language", { language: "pt", confidence: 0.95 }],
  ["german-language", { language: "de", confidence: 0.95 }],
  ["german language", { language: "de", confidence: 0.95 }],
  ["italian-language", { language: "it", confidence: 0.95 }],
  ["italian language", { language: "it", confidence: 0.95 }],
  ["arabic-language", { language: "ar", confidence: 0.95 }],
  ["arabic language", { language: "ar", confidence: 0.95 }],
  ["hindi-language", { language: "hi", confidence: 0.95 }],
  ["hindi language", { language: "hi", confidence: 0.95 }]
]);

export interface InferredLanguageShare {
  language: LanguageValue;
  percentage: number;
}

export interface ArtistLanguageEvidence {
  artistName: string;
  status: "known" | "unknown";
  languages: Array<{
    language: LanguageValue;
    confidence: number;
    source: "curated" | "musicbrainz-tag";
    sourceTag?: string;
  }>;
  musicBrainzId?: string;
}

export interface ArtistLanguageInferenceResult {
  /** Percentages among artists with reliable evidence; always total 100 when non-empty. */
  distribution: InferredLanguageShare[];
  /** Weighted share of input artists for which no reliable language evidence exists. */
  unknownPercentage: number;
  evidence: ArtistLanguageEvidence[];
}

export interface ArtistLanguageInferenceDependencies {
  resolveArtist: (name: string) => Promise<ResolvedMusicBrainzArtist | undefined>;
}

/**
 * Builds a soft language profile from explicit artist preferences. This result
 * is for ranking only: it must never be used to remove otherwise valid events.
 */
export async function inferArtistLanguagePreferences(
  artists: readonly WeightedPreference[],
  dependencies: ArtistLanguageInferenceDependencies
): Promise<ArtistLanguageInferenceResult> {
  const languageTotals = new Map<LanguageValue, number>();
  const evidence: ArtistLanguageEvidence[] = [];
  let knownWeight = 0;
  let unknownWeight = 0;

  for (const artist of artists) {
    const artistWeight = PREFERENCE_WEIGHT[artist.weight];
    const curated = findArtistProfile(artist.name, artist.canonicalId);
    if (curated) {
      const supported = curated.languages.flatMap((item) => {
        const language = normalizeLanguageTag(item.language);
        if (!isLanguageValue(language) || item.confidence < 0.75) return [];
        return [{
          language,
          confidence: item.confidence,
          roleWeight: ROLE_WEIGHT[item.role],
          source: "curated" as const
        }];
      });
      if (supported.length > 0) {
        addArtistVote(languageTotals, artistWeight, supported);
        knownWeight += artistWeight;
        evidence.push({
          artistName: artist.name,
          status: "known",
          languages: supported.map(({ language, confidence, source }) => ({
            language,
            confidence,
            source
          }))
        });
        continue;
      }
    }

    let resolved: ResolvedMusicBrainzArtist | undefined;
    try {
      resolved = await dependencies.resolveArtist(artist.name);
    } catch {
      resolved = undefined;
    }
    const supported = languageEvidenceFromMetadata(resolved);
    if (resolved && supported.length > 0) {
      addArtistVote(
        languageTotals,
        artistWeight,
        supported.map((item) => ({ ...item, roleWeight: 1 }))
      );
      knownWeight += artistWeight;
      evidence.push({
        artistName: artist.name,
        status: "known",
        languages: supported,
        musicBrainzId: resolved.id
      });
    } else {
      unknownWeight += artistWeight;
      evidence.push({
        artistName: artist.name,
        status: "unknown",
        languages: [],
        ...(resolved ? { musicBrainzId: resolved.id } : {})
      });
    }
  }

  const totalInputWeight = knownWeight + unknownWeight;
  return {
    distribution: percentageDistribution(languageTotals),
    unknownPercentage:
      totalInputWeight === 0 ? 100 : roundOneDecimal((unknownWeight / totalInputWeight) * 100),
    evidence
  };
}

function languageEvidenceFromMetadata(
  artist: ResolvedMusicBrainzArtist | undefined
): ArtistLanguageEvidence["languages"] {
  if (!artist) return [];
  const result = new Map<LanguageValue, ArtistLanguageEvidence["languages"][number]>();
  for (const rawTag of [...(artist.tags ?? []), ...(artist.genres ?? [])]) {
    const normalizedTag = rawTag.normalize("NFKC").toLocaleLowerCase("en-US").trim();
    const rule = LANGUAGE_TAG_RULES.get(normalizedTag);
    if (!rule) continue;
    const existing = result.get(rule.language);
    if (!existing || rule.confidence > existing.confidence) {
      result.set(rule.language, {
        language: rule.language,
        confidence: rule.confidence,
        source: "musicbrainz-tag",
        sourceTag: rawTag
      });
    }
  }
  return [...result.values()];
}

function addArtistVote(
  totals: Map<LanguageValue, number>,
  artistWeight: number,
  languages: ReadonlyArray<{
    language: LanguageValue;
    confidence: number;
    roleWeight: number;
  }>
): void {
  const contributions = languages.map((item) => ({
    language: item.language,
    value: item.confidence * item.roleWeight
  }));
  const contributionTotal = contributions.reduce((sum, item) => sum + item.value, 0);
  if (contributionTotal <= 0) return;
  for (const contribution of contributions) {
    totals.set(
      contribution.language,
      (totals.get(contribution.language) ?? 0) +
        artistWeight * (contribution.value / contributionTotal)
    );
  }
}

function percentageDistribution(totals: Map<LanguageValue, number>): InferredLanguageShare[] {
  const entries = [...totals.entries()].sort((left, right) => right[1] - left[1]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return [];

  let assigned = 0;
  return entries.map(([language, value], index) => {
    const percentage =
      index === entries.length - 1
        ? roundOneDecimal(100 - assigned)
        : roundOneDecimal((value / total) * 100);
    assigned += percentage;
    return { language, percentage };
  });
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}
