import type {
  NormalizedEvent,
  ProviderCapability,
  ValidationInput,
} from "../core/types";
import { forecastEnd } from "../core/forecast.js";
import { findArtistProfile } from "../data/artistProfiles.js";
import type { EventProvider, ProviderDependencies } from "./types";
import { ProviderRequestError, ProviderUnavailableError } from "./types";
import {
  candidateRadiusMiles,
  canonicalEventKey,
  coordinates,
  deduplicateProviderEvents,
  distributeProviderBudget,
  encodeGeohash,
  fallbackArtistQueryName,
  forecastTimeBuckets,
  inactiveStatusFromEventTitle,
  isRecoverableProviderError,
  mapEventStatus,
  preferredArtistQueryName,
  requestSignal,
  safeProviderUrl,
  uniqueStrings,
} from "./utils";

const DEFAULT_BASE_URL = "https://app.ticketmaster.com/discovery/v2";

type JsonRecord = Record<string, unknown>;

interface TicketmasterQuery {
  attractionId?: string;
  keyword?: string;
  fallbackKeyword?: string;
  explicit: boolean;
  startAt?: Date;
  endAt?: Date;
  size?: number;
  sort?: "date,asc" | "relevance,desc";
}

const REGIONAL_EVENT_BUDGET = 150;
const MAX_DISCOVERY_ARTISTS = 8;

export interface TicketmasterProviderOptions extends ProviderDependencies {
  apiKey?: string;
  baseUrl?: string;
  minRequestIntervalMs?: number;
}

export class TicketmasterProvider implements EventProvider {
  readonly id = "ticketmaster" as const;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly minRequestIntervalMs: number;

  constructor(options: TicketmasterProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.requestTimeoutMs ?? 10_000;
    // Ticketmaster's public FAQ documents a conservative 2 requests/second.
    this.minRequestIntervalMs = options.minRequestIntervalMs ?? 500;
  }

  capability(): ProviderCapability {
    return this.apiKey
      ? {
          id: this.id,
          label: "Ticketmaster Discovery",
          mode: "live",
          message: "已配置，可用于本地非商业验证。",
        }
      : {
          id: this.id,
          label: "Ticketmaster Discovery",
          mode: "unconfigured",
          message: "需要服务端 TICKETMASTER_API_KEY。",
        };
  }

  async fetchEvents(input: ValidationInput): Promise<NormalizedEvent[]> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new ProviderUnavailableError(
        this.id,
        "Ticketmaster 未配置服务端 API key。",
      );
    }

    const now = this.now();
    const explicitQueries: TicketmasterQuery[] = input.artists.map((artist) => {
      const profile = findArtistProfile(artist.name, artist.canonicalId) ??
        artist.aliases?.map((alias) => findArtistProfile(alias)).find(Boolean);
      const attractionId = profile?.providerIds?.ticketmaster;
      const keyword = attractionId ? undefined : preferredArtistQueryName(artist);
      return {
        attractionId,
        keyword,
        fallbackKeyword: fallbackArtistQueryName(
          artist,
          profile?.aliases ?? [],
          keyword,
        ),
        explicit: true,
      };
    });
    const discoveryQueries: TicketmasterQuery[] = (input.discoveryArtists ?? [])
      .slice(0, MAX_DISCOVERY_ARTISTS)
      .map((artist) => {
        const profile = findArtistProfile(artist.name, artist.canonicalId) ??
          artist.aliases?.map((alias) => findArtistProfile(alias)).find(Boolean);
        const attractionId = profile?.providerIds?.ticketmaster;
        return attractionId
          ? { attractionId, explicit: false }
          : { keyword: preferredArtistQueryName(artist), explicit: false };
      });
    const regionalBuckets = forecastTimeBuckets(now, input.forecastMonths, 6);
    const regionalSizes = distributeProviderBudget(
      REGIONAL_EVENT_BUDGET,
      regionalBuckets.length,
    );
    const regionalQueries: TicketmasterQuery[] = regionalBuckets.map(
      (bucket, index) => ({
        explicit: false,
        startAt: bucket.start,
        endAt: bucket.end,
        size: regionalSizes[index],
        sort: "relevance,desc",
      }),
    );
    // Exact artist queries protect recall. Time-stratified regional queries
    // cover the entire horizon instead of spending the budget on its first week.
    const queries: TicketmasterQuery[] = [
      ...explicitQueries,
      ...discoveryQueries,
      ...regionalQueries,
    ];
    const allEvents: NormalizedEvent[] = [];
    const errors: Error[] = [];
    let successfulQueries = 0;

    let requestCount = 0;
    const requestQuery = async (
      query: Pick<
        TicketmasterQuery,
        "attractionId" | "keyword" | "startAt" | "endAt" | "size" | "sort"
      >,
    ): Promise<{ events: NormalizedEvent[]; rawEventCount: number }> => {
      if (requestCount > 0 && this.minRequestIntervalMs > 0) {
        await delay(this.minRequestIntervalMs);
      }
      requestCount += 1;
      const params = new URLSearchParams({
        apikey: apiKey,
        classificationName: "Music",
        startDateTime: ticketmasterDateTime(query.startAt ?? now),
        endDateTime: ticketmasterDateTime(
          query.endAt ?? forecastEnd(now, input.forecastMonths),
        ),
        geoPoint: encodeGeohash(input.origin),
        radius: String(candidateRadiusMiles(input.maxTravelMinutes)),
        unit: "miles",
        size: String(query.size ?? 100),
        page: "0",
        sort: query.sort ?? "date,asc",
        includeTBA: "no",
        includeTBD: "no",
        locale: "*",
      });
      if (query.attractionId) params.set("attractionId", query.attractionId);
      else if (query.keyword) params.set("keyword", query.keyword);

      const response = await this.fetcher(`${this.baseUrl}/events.json?${params}`, {
        headers: { Accept: "application/json" },
        signal: requestSignal(this.timeoutMs),
      });
      if (!response.ok) {
        throw new ProviderRequestError(
          this.id,
          `Ticketmaster request failed (${response.status}).`,
          response.status,
        );
      }

      const payload = (await response.json()) as JsonRecord;
      const embedded = record(payload._embedded);
      const rawEvents = array(embedded?.events);
      const events = rawEvents
        .map((event) => normalizeTicketmasterEvent(event, now))
        .filter((event): event is NormalizedEvent => Boolean(event));
      return { events, rawEventCount: rawEvents.length };
    };

    const recordFailure = (error: unknown): Error => {
      const failure = error instanceof Error
        ? error
        : new ProviderRequestError(this.id, "Ticketmaster request failed.");
      errors.push(failure);
      return failure;
    };

    // Direct artist queries protect long-tail artists from a popularity-ranked
    // regional feed. Keep these serial to be conservative with provider quotas.
    for (const query of queries) {
      let shouldFallback = false;
      try {
        const result = await requestQuery(query);
        allEvents.push(...result.events);
        successfulQueries += 1;
        shouldFallback = query.explicit && result.rawEventCount === 0;
      } catch (error) {
        const failure = recordFailure(error);
        shouldFallback = query.explicit && isRecoverableProviderError(failure);
      }

      if (shouldFallback && query.fallbackKeyword) {
        try {
          const fallback = await requestQuery({ keyword: query.fallbackKeyword });
          allEvents.push(...fallback.events);
          successfulQueries += 1;
        } catch (error) {
          recordFailure(error);
        }
      }
    }

    if (successfulQueries === 0) {
      throw errors[0] ?? new ProviderRequestError(this.id, "Ticketmaster request failed.");
    }
    return deduplicateProviderEvents(allEvents);
  }
}

export function normalizeTicketmasterEvent(
  value: unknown,
  fetchedAt = new Date(),
): NormalizedEvent | undefined {
  const event = record(value);
  if (!event) return undefined;
  const eventId = text(event.id);
  const name = text(event.name);
  if (!eventId || !name) return undefined;

  const dates = record(event.dates);
  const start = record(dates?.start);
  const startAt =
    text(start?.dateTime) ?? localDateTime(text(start?.localDate), text(start?.localTime));
  if (!startAt) return undefined;

  const embedded = record(event._embedded);
  const venue = array(embedded?.venues).map(record).find(Boolean);
  const venueName = text(venue?.name) ?? "Venue TBA";
  const city = record(venue?.city);
  const state = record(venue?.state);
  const location = record(venue?.location);

  const attractions = array(embedded?.attractions)
    .map(record)
    .filter((item): item is JsonRecord => Boolean(item));
  const performers = attractions
    .map((attraction) => {
      const performerName = text(attraction.name);
      if (!performerName) return undefined;
      return {
        name: performerName,
        canonicalId: text(attraction.id),
        role: "unknown" as const,
      };
    })
    .filter((performer): performer is NonNullable<typeof performer> => Boolean(performer));

  const classifications = array(event.classifications)
    .map(record)
    .filter((item): item is JsonRecord => Boolean(item));
  const genres = uniqueStrings(
    classifications.flatMap((classification) => {
      const genre = record(classification.genre);
      const subGenre = record(classification.subGenre);
      return [text(genre?.name), text(subGenre?.name)];
    }),
  );

  const sales = record(event.sales);
  const publicSale = record(sales?.public);
  const status = record(dates?.status);
  const rawStatus = text(status?.code);
  const providerStatus = mapEventStatus(rawStatus);
  const titleStatus = inactiveStatusFromEventTitle(name);
  const normalizedStatus =
    providerStatus === "cancelled" || providerStatus === "postponed"
      ? providerStatus
      : (titleStatus?.status ?? providerStatus);
  const notes = uniqueStrings([
    rawStatus?.toLocaleLowerCase("en-US").includes("rescheduled")
      ? "Ticketmaster status: rescheduled"
      : undefined,
    titleStatus?.note,
  ]);

  return {
    canonicalKey: canonicalEventKey(name, startAt, venueName),
    name,
    startAt,
    status: normalizedStatus,
    venue: {
      name: venueName,
      city: text(city?.name),
      region: text(state?.stateCode) ?? text(state?.name),
      coordinates: coordinates(location?.latitude, location?.longitude),
    },
    performers,
    genres,
    languages: [],
    sources: [
      {
        provider: "ticketmaster",
        eventId,
        url: safeProviderUrl("ticketmaster", text(event.url)),
        fetchedAt: fetchedAt.toISOString(),
        mode: "live",
      },
    ],
    onSaleAt: text(publicSale?.startDateTime),
    notes: notes.length > 0 ? notes : undefined,
  };
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function localDateTime(date?: string, time?: string): string | undefined {
  if (!date) return undefined;
  return `${date}T${time ?? "00:00:00"}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function ticketmasterDateTime(value: Date): string {
  // Discovery API rejects ISO timestamps with fractional seconds.
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}
