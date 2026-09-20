import { findArtistProfile, normalizeArtistName } from "../data/artistProfiles.js";
import type {
  EventSource,
  LanguageEvidence,
  NormalizedEvent,
  Performer
} from "./types.js";

function normalizedText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/\b(live|concert|tour|show)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedVenue(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sourceKey(source: EventSource): string {
  return `${source.provider}:${source.eventId}`;
}

function sameVenue(left: NormalizedEvent, right: NormalizedEvent): boolean {
  const leftVenue = normalizedVenue(left.venue.name);
  const rightVenue = normalizedVenue(right.venue.name);
  const leftCity = normalizedVenue(left.venue.city);
  const rightCity = normalizedVenue(right.venue.city);

  if (
    leftVenue &&
    rightVenue &&
    leftVenue === rightVenue &&
    (!leftCity || !rightCity || leftCity === rightCity)
  ) {
    return true;
  }

  return false;
}

function performerIdentity(performer: Performer): string {
  const profile = findArtistProfile(performer.name, performer.canonicalId);
  return profile
    ? `profile:${profile.canonicalId}`
    : `name:${normalizeArtistName(performer.name)}`;
}

function hasOverlappingPerformer(left: NormalizedEvent, right: NormalizedEvent): boolean {
  const leftPerformers = new Set(left.performers.map(performerIdentity));
  return right.performers.some((performer) => leftPerformers.has(performerIdentity(performer)));
}

function hasCrossProviderPair(left: NormalizedEvent, right: NormalizedEvent): boolean {
  return left.sources.some((leftSource) =>
    right.sources.some((rightSource) => leftSource.provider !== rightSource.provider)
  );
}

function startsWithinTolerance(left: NormalizedEvent, right: NormalizedEvent): boolean {
  const leftInstant = Date.parse(left.startAt);
  const rightInstant = Date.parse(right.startAt);
  if (!Number.isFinite(leftInstant) || !Number.isFinite(rightInstant)) return false;
  return Math.abs(leftInstant - rightInstant) <= 30 * 60 * 1_000;
}

function isSameEvent(left: NormalizedEvent, right: NormalizedEvent): boolean {
  const leftSources = new Set(left.sources.map(sourceKey));
  if (right.sources.some((source) => leftSources.has(sourceKey(source)))) return true;

  // Provider IDs are scoped to their provider. Different IDs from the same
  // provider never fuzzy-merge, even if the listing text happens to match.
  if (!hasCrossProviderPair(left, right)) return false;

  if (!sameVenue(left, right)) return false;
  if (!startsWithinTolerance(left, right)) return false;
  return hasOverlappingPerformer(left, right);
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const result = new Map<string, T>();
  for (const item of items) {
    const itemKey = key(item);
    if (!result.has(itemKey)) result.set(itemKey, item);
  }
  return [...result.values()];
}

function mergePerformers(left: Performer[], right: Performer[]): Performer[] {
  return uniqueBy([...left, ...right], performerIdentity);
}

function mergeLanguages(left: LanguageEvidence[], right: LanguageEvidence[]): LanguageEvidence[] {
  const result = new Map<string, LanguageEvidence>();
  for (const language of [...left, ...right]) {
    const key = normalizedText(language.language);
    const existing = result.get(key);
    if (!existing || language.confidence > existing.confidence) result.set(key, language);
  }
  return [...result.values()];
}

const STATUS_PRIORITY = {
  active: 0,
  unknown: 1,
  postponed: 2,
  cancelled: 3
} as const;

function preferredVenue(left: NormalizedEvent, right: NormalizedEvent): NormalizedEvent["venue"] {
  const richness = (event: NormalizedEvent) =>
    Number(Boolean(event.venue.coordinates)) +
    Number(Boolean(event.venue.city)) +
    Number(Boolean(event.venue.region));
  return richness(right) > richness(left) ? right.venue : left.venue;
}

function mergeEvent(left: NormalizedEvent, right: NormalizedEvent): NormalizedEvent {
  const sources = uniqueBy([...left.sources, ...right.sources], sourceKey).sort((a, b) =>
    sourceKey(a).localeCompare(sourceKey(b))
  );
  const canonicalKey = [left.canonicalKey, right.canonicalKey].filter(Boolean).sort()[0] ?? "";

  return {
    ...left,
    canonicalKey,
    status:
      STATUS_PRIORITY[right.status] > STATUS_PRIORITY[left.status] ? right.status : left.status,
    venue: preferredVenue(left, right),
    performers: mergePerformers(left.performers, right.performers),
    genres: uniqueBy([...left.genres, ...right.genres], normalizedText),
    languages: mergeLanguages(left.languages, right.languages),
    sources,
    isTribute: Boolean(left.isTribute || right.isTribute),
    onSaleAt: left.onSaleAt ?? right.onSaleAt,
    notes: uniqueBy([...(left.notes ?? []), ...(right.notes ?? [])], normalizedText)
  };
}

/** Combines provider duplicates while retaining every distinct source link. */
export function deduplicateEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const groups: NormalizedEvent[] = [];

  for (const event of [...events].sort((a, b) => {
    const timeDifference = Date.parse(a.startAt) - Date.parse(b.startAt);
    if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
    return a.canonicalKey.localeCompare(b.canonicalKey);
  })) {
    const matchingIndex = groups.findIndex((candidate) => isSameEvent(candidate, event));
    if (matchingIndex === -1) {
      groups.push({ ...event, sources: [...event.sources] });
      continue;
    }

    const existing = groups[matchingIndex];
    if (existing) groups[matchingIndex] = mergeEvent(existing, event);
  }

  return groups;
}
