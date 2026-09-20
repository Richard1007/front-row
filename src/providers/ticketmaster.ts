import type {
  NormalizedEvent,
  ProviderCapability,
  ValidationInput,
} from "../core/types";
import type { EventProvider, ProviderDependencies } from "./types";
import { ProviderRequestError, ProviderUnavailableError } from "./types";
import {
  candidateRadiusMiles,
  canonicalEventKey,
  coordinates,
  deduplicateProviderEvents,
  encodeGeohash,
  forecastEnd,
  mapEventStatus,
  requestSignal,
  safeProviderUrl,
  uniqueStrings,
} from "./utils";

const DEFAULT_BASE_URL = "https://app.ticketmaster.com/discovery/v2";

type JsonRecord = Record<string, unknown>;

export interface TicketmasterProviderOptions extends ProviderDependencies {
  apiKey?: string;
  baseUrl?: string;
}

export class TicketmasterProvider implements EventProvider {
  readonly id = "ticketmaster" as const;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(options: TicketmasterProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.requestTimeoutMs ?? 10_000;
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
    if (!this.apiKey) {
      throw new ProviderUnavailableError(
        this.id,
        "Ticketmaster 未配置服务端 API key。",
      );
    }

    const now = this.now();
    const artists = uniqueStrings(input.artists.map((artist) => artist.name));
    // Exact artist queries protect recall. The final un-keyworded regional query
    // supplies discovery candidates for genre/language scoring.
    const queries: Array<string | undefined> = [...artists, undefined];
    const allEvents: NormalizedEvent[] = [];
    const errors: Error[] = [];
    let successfulQueries = 0;

    // Direct artist queries protect long-tail artists from a popularity-ranked
    // regional feed. Keep these serial to be conservative with provider quotas.
    for (const artist of queries) {
      const params = new URLSearchParams({
        apikey: this.apiKey,
        classificationName: "Music",
        startDateTime: now.toISOString(),
        endDateTime: forecastEnd(now, input.forecastDays).toISOString(),
        geoPoint: encodeGeohash(input.origin),
        radius: String(candidateRadiusMiles(input.maxTravelMinutes)),
        unit: "miles",
        size: "100",
        page: "0",
        sort: "date,asc",
        includeTBA: "no",
        includeTBD: "no",
        locale: "*",
      });
      if (artist) params.set("keyword", artist);

      try {
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
        const events = array(embedded?.events);
        for (const event of events) {
          const normalized = normalizeTicketmasterEvent(event, now);
          if (normalized) allEvents.push(normalized);
        }
        successfulQueries += 1;
      } catch (error) {
        errors.push(
          error instanceof Error
            ? error
            : new ProviderRequestError(this.id, "Ticketmaster request failed."),
        );
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
  const notes = rawStatus?.toLocaleLowerCase("en-US").includes("rescheduled")
    ? ["Ticketmaster status: rescheduled"]
    : undefined;

  return {
    canonicalKey: canonicalEventKey(name, startAt, venueName),
    name,
    startAt,
    status: mapEventStatus(rawStatus),
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
    notes,
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
