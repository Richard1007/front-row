import {
  findArtistProfile,
  normalizeLanguageTag
} from "../data/artistProfiles.js";
import type {
  LanguageEvidence,
  NormalizedEvent,
  Performer,
  ValidationInput,
  WeightedPreference
} from "./types.js";

function enrichPreference(preference: WeightedPreference): WeightedPreference {
  const profile = findArtistProfile(preference.name, preference.canonicalId);
  if (!profile) return preference;
  return {
    ...preference,
    canonicalId: preference.canonicalId ?? profile.canonicalId,
    aliases: [...new Set([...(preference.aliases ?? []), ...profile.aliases])]
  };
}

function enrichPerformer(performer: Performer): Performer {
  const profile = findArtistProfile(performer.name, performer.canonicalId);
  if (!profile) return performer;
  return { ...performer, canonicalId: performer.canonicalId ?? profile.canonicalId };
}

function mergeLanguageEvidence(
  existing: LanguageEvidence[],
  additional: readonly LanguageEvidence[]
): LanguageEvidence[] {
  const result = new Map<string, LanguageEvidence>();
  for (const evidence of [...existing, ...additional]) {
    const normalized = { ...evidence, language: normalizeLanguageTag(evidence.language) };
    const key = `${normalized.language}:${normalized.role}`;
    const current = result.get(key);
    if (!current || normalized.confidence > current.confidence) result.set(key, normalized);
  }
  return [...result.values()];
}

export function enrichValidationInput(input: ValidationInput): ValidationInput {
  return {
    ...input,
    artists: input.artists.map(enrichPreference),
    languages: input.languages.map((language) => ({
      ...language,
      language: normalizeLanguageTag(language.language)
    })),
    inferredLanguages: input.inferredLanguages?.map((language) => ({
      ...language,
      language: normalizeLanguageTag(language.language)
    }))
  };
}

export function enrichEvent(event: NormalizedEvent): NormalizedEvent {
  const profiles = event.performers
    .map((performer) => findArtistProfile(performer.name, performer.canonicalId))
    .filter((profile) => profile !== undefined);
  const profileLanguages = profiles.flatMap((profile) => profile.languages);

  return {
    ...event,
    performers: event.performers.map(enrichPerformer),
    languages: mergeLanguageEvidence(event.languages, profileLanguages)
  };
}
