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
  fallbackArtistQueryName,
  inactiveStatusFromEventTitle,
  isRecoverableProviderError,
  mapEventStatus,
  preferredArtistQueryName,
  requestSignal,
  safeProviderUrl,
  uniqueStrings,
} from "./utils";

const DEFAULT_BASE_URL = "https://api.data.jambase.com/v3";
type JsonRecord = Record<string, unknown>;

interface JamBaseQuery {
  params: URLSearchParams;
  fallbackName?: string;
  explicit: boolean;
}

export interface JamBaseProviderOptions extends ProviderDependencies {
  apiKey?: string;
  baseUrl?: string;
  userAgent?: string;
}

export class JamBaseProvider implements EventProvider {
  readonly id = "jambase" as const;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: JamBaseProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.userAgent = options.userAgent ?? "FrontRow/0.1 (local-validation)";
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.requestTimeoutMs ?? 10_000;
  }

  capability(): ProviderCapability {
    return this.apiKey
      ? {
          id: this.id,
          label: "JamBase Data",
          mode: "live",
          message: "已配置，可用于本地验证；展示数据时需保留 JamBase attribution。",
        }
      : {
          id: this.id,
          label: "JamBase Data",
          mode: "unconfigured",
          message: "需要服务端 JBD_API_KEY（也兼容 JAMBASE_API_KEY）。",
        };
  }

  async fetchEvents(input: ValidationInput): Promise<NormalizedEvent[]> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new ProviderUnavailableError(this.id, "JamBase 未配置服务端 API key。");
    }

    const now = this.now();
    const commonParams: Record<string, string> = {
      eventDateFrom: isoDate(now),
      eventDateTo: isoDate(forecastEnd(now, input.forecastMonths)),
      geoLatitude: String(input.origin.latitude),
      geoLongitude: String(input.origin.longitude),
      geoRadiusAmount: String(candidateRadiusMiles(input.maxTravelMinutes)),
      geoRadiusUnits: "mi",
      perPage: "100",
      page: "1",
    };
    const explicitQueries: JamBaseQuery[] = input.artists.map((artist) => {
      const profile = findArtistProfile(artist.name, artist.canonicalId) ??
        artist.aliases?.map((alias) => findArtistProfile(alias)).find(Boolean);
      const artistId = profile?.providerIds?.jambase;
      const artistName = artistId ? undefined : preferredArtistQueryName(artist);
      return {
        params: new URLSearchParams(
          artistId
            ? { ...commonParams, artistId }
            : { ...commonParams, artistName: artistName! },
        ),
        fallbackName: fallbackArtistQueryName(
          artist,
          profile?.aliases ?? [],
          artistName,
        ),
        explicit: true,
      };
    });
    const discoveryQueries: JamBaseQuery[] = (input.discoveryArtists ?? [])
      .slice(0, 12)
      .map((artist) => {
        const profile = findArtistProfile(artist.name, artist.canonicalId) ??
          artist.aliases?.map((alias) => findArtistProfile(alias)).find(Boolean);
        const artistId = profile?.providerIds?.jambase;
        return {
          params: new URLSearchParams(
            artistId
              ? { ...commonParams, artistId }
              : { ...commonParams, artistName: preferredArtistQueryName(artist) },
          ),
          explicit: false,
        };
      });
    const queries: JamBaseQuery[] = [
      ...explicitQueries,
      ...discoveryQueries,
      { params: new URLSearchParams(commonParams), explicit: false },
    ];

    const allEvents: NormalizedEvent[] = [];
    const errors: Error[] = [];
    let successfulQueries = 0;

    const requestQuery = async (
      params: URLSearchParams,
    ): Promise<{ events: NormalizedEvent[]; rawEventCount: number }> => {
      const response = await this.fetcher(`${this.baseUrl}/events?${params}`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": this.userAgent,
        },
        signal: requestSignal(this.timeoutMs),
      });
      if (!response.ok) {
        throw new ProviderRequestError(
          this.id,
          `JamBase request failed (${response.status}).`,
          response.status,
        );
      }

      const payload = (await response.json()) as JsonRecord;
      const rawEvents = Array.isArray(payload.events) ? payload.events : [];
      const events = rawEvents
        .map((event) => normalizeJamBaseEvent(event, now))
        .filter((event): event is NormalizedEvent => Boolean(event));
      return { events, rawEventCount: rawEvents.length };
    };

    const recordFailure = (error: unknown): Error => {
      const failure = error instanceof Error
        ? error
        : new ProviderRequestError(this.id, "JamBase request failed.");
      errors.push(failure);
      return failure;
    };

    // Keep requests serial to avoid consuming the small pilot quota in bursts.
    for (const query of queries) {
      let shouldFallback = false;
      try {
        const result = await requestQuery(query.params);
        allEvents.push(...result.events);
        successfulQueries += 1;
        shouldFallback = query.explicit && result.rawEventCount === 0;
      } catch (error) {
        const failure = recordFailure(error);
        shouldFallback = query.explicit && isRecoverableProviderError(failure);
      }

      if (shouldFallback && query.fallbackName) {
        try {
          const fallbackParams = new URLSearchParams(commonParams);
          fallbackParams.set("artistName", query.fallbackName);
          const fallback = await requestQuery(fallbackParams);
          allEvents.push(...fallback.events);
          successfulQueries += 1;
        } catch (error) {
          recordFailure(error);
        }
      }
    }

    if (successfulQueries === 0) {
      throw errors[0] ?? new ProviderRequestError(this.id, "JamBase request failed.");
    }
    return deduplicateProviderEvents(allEvents);
  }
}

export function normalizeJamBaseEvent(
  value: unknown,
  fetchedAt = new Date(),
): NormalizedEvent | undefined {
  const event = record(value);
  if (!event || event.deletionStatus) return undefined;
  const eventId = text(event.identifier);
  const name = text(event.name);
  const startAt = text(event.startDate);
  if (!eventId || !name || !startAt) return undefined;

  const location = record(event.location);
  const venueName = text(location?.name) ?? "Venue TBA";
  const address = record(location?.address);
  const region = record(address?.addressRegion);
  const geo = record(location?.geo);
  const rawPerformers = list(event.performer)
    .map(record)
    .filter((item): item is JsonRecord => Boolean(item));
  const performers = rawPerformers
    .map((performer) => {
      const performerName = text(performer.name);
      if (!performerName) return undefined;
      const headliner = performer["x-isHeadliner"];
      return {
        name: performerName,
        canonicalId: text(performer.identifier),
        role:
          headliner === true
            ? ("headliner" as const)
            : headliner === false
              ? ("support" as const)
              : ("unknown" as const),
      };
    })
    .filter((performer): performer is NonNullable<typeof performer> => Boolean(performer));

  const genres = uniqueStrings([
    text(event["x-genre"]),
    ...rawPerformers.flatMap((performer) => list(performer.genre).map(text)),
  ]);
  const offers = list(event.offers)
    .map(record)
    .filter((item): item is JsonRecord => Boolean(item));
  const firstOnSaleAt = offers.map((offer) => text(offer.validFrom)).find(Boolean);
  const rawStatus = text(event.eventStatus);
  const providerStatus = mapEventStatus(rawStatus);
  const titleStatus = inactiveStatusFromEventTitle(name);
  const normalizedStatus =
    providerStatus === "cancelled" || providerStatus === "postponed"
      ? providerStatus
      : (titleStatus?.status ?? providerStatus);
  const notes = uniqueStrings([
    rawStatus?.toLocaleLowerCase("en-US") === "rescheduled"
      ? "JamBase status: rescheduled"
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
      city: text(address?.addressLocality),
      region: text(region?.alternateName) ?? text(region?.name) ?? text(address?.addressRegion),
      coordinates: coordinates(geo?.latitude, geo?.longitude),
    },
    performers,
    genres,
    languages: [],
    sources: [
      {
        provider: "jambase",
        eventId,
        url: safeProviderUrl("jambase", text(event.url)),
        fetchedAt: fetchedAt.toISOString(),
        mode: "live",
      },
    ],
    onSaleAt: firstOnSaleAt,
    notes: notes.length > 0 ? notes : undefined,
  };
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
