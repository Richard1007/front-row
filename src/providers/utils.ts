import type {
  Coordinates,
  EventStatus,
  NormalizedEvent,
  ProviderId,
  WeightedPreference,
} from "../core/types";
import { forecastEnd, forecastMonths } from "../core/forecast.js";

export interface ForecastTimeBucket {
  start: Date;
  end: Date;
}

/**
 * Split the complete forecast into contiguous calendar-month groups. A bounded
 * number of buckets lets providers sample every part of the user's horizon
 * without paging through an unbounded regional catalog.
 */
export function forecastTimeBuckets(
  start: Date,
  months: number | undefined,
  maxBuckets: number,
): ForecastTimeBucket[] {
  const normalizedMonths = forecastMonths(months);
  const bucketCount = Math.max(1, Math.min(normalizedMonths, Math.floor(maxBuckets)));
  const buckets: ForecastTimeBucket[] = [];

  for (let index = 0; index < bucketCount; index += 1) {
    const startMonthOffset = Math.floor((index * normalizedMonths) / bucketCount);
    const endMonthOffset = Math.floor(((index + 1) * normalizedMonths) / bucketCount);
    buckets.push({
      start: startMonthOffset === 0
        ? new Date(start)
        : forecastEnd(start, startMonthOffset),
      end: forecastEnd(start, endMonthOffset),
    });
  }

  return buckets;
}

/** Distribute a fixed result budget without allowing any request over its cap. */
export function distributeProviderBudget(
  total: number,
  bucketCount: number,
  maxPerBucket = 100,
): number[] {
  if (bucketCount <= 0 || total <= 0 || maxPerBucket <= 0) return [];
  const safeTotal = Math.min(
    Math.floor(total),
    Math.floor(bucketCount) * Math.floor(maxPerBucket),
  );
  const base = Math.floor(safeTotal / bucketCount);
  const remainder = safeTotal % bucketCount;
  return Array.from(
    { length: bucketCount },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

export function preferredArtistQueryName(
  artist: Pick<WeightedPreference, "name" | "aliases">,
): string {
  return (
    artist.aliases?.find(
      (alias) => /^[\x20-\x7E]+$/.test(alias) && /[A-Za-z]/.test(alias),
    ) ?? artist.name
  );
}

/**
 * Select one confirmed spelling variant for a bounded provider fallback.
 * ASCII aliases are preferred because ticketing catalogs commonly register
 * international artists under a Latin-script billing name. The caller is
 * responsible for using this only for an explicit user preference.
 */
export function fallbackArtistQueryName(
  artist: Pick<WeightedPreference, "aliases">,
  confirmedAliases: readonly string[],
  primaryQueryName?: string,
): string | undefined {
  const primaryKey = primaryQueryName
    ?.normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .trim();
  const candidates = uniqueStrings([
    ...(artist.aliases ?? []),
    ...confirmedAliases,
  ]).filter(
    (alias) =>
      alias.normalize("NFKC").toLocaleLowerCase("en-US").trim() !== primaryKey,
  );

  return (
    candidates.find(
      (alias) => /^[\x20-\x7E]+$/.test(alias) && /[A-Za-z]/.test(alias),
    ) ?? candidates[0]
  );
}

/** Network failures, throttling, timeouts, and server errors can be retried
 * through one alternate catalog spelling. Authentication and other 4xx
 * responses are deterministic and must not consume another provider call. */
export function isRecoverableProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const status = "status" in error ? (error as { status?: unknown }).status : undefined;
  if (typeof status !== "number") return true;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * A provider radius is only a broad candidate filter. Route-time eligibility is
 * calculated later; 0.75 miles/minute gives a two-hour Bay Area search a
 * deliberately generous 90-mile envelope without pretending it is drive time.
 */
export function candidateRadiusMiles(maxTravelMinutes: number): number {
  return Math.max(5, Math.min(200, Math.ceil(maxTravelMinutes * 0.75)));
}

export function canonicalEventKey(
  name: string,
  startAt: string,
  venueName: string,
): string {
  const date = startAt.slice(0, 10);
  return [name, venueName, date]
    .map((part) =>
      part
        .normalize("NFKD")
        .toLocaleLowerCase("en-US")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim(),
    )
    .join("|");
}

export function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function coordinates(
  latitude: unknown,
  longitude: unknown,
): Coordinates | undefined {
  const lat = finiteNumber(latitude);
  const lng = finiteNumber(longitude);
  if (lat === undefined || lng === undefined) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { latitude: lat, longitude: lng };
}

export function mapEventStatus(value: unknown): EventStatus {
  if (typeof value !== "string") return "unknown";
  const status = value.toLocaleLowerCase("en-US");
  if (status.includes("cancel")) return "cancelled";
  if (status.includes("postpone")) return "postponed";
  if (
    status.includes("scheduled") ||
    status.includes("rescheduled") ||
    status === "onsale" ||
    status === "offsale"
  ) {
    return "active";
  }
  return "unknown";
}

/**
 * Some provider feeds leave an obsolete listing marked active while adding an
 * editorial status to its title. Only explicit status wording is recognized;
 * labels such as "Rescheduled Date" may describe the valid replacement show
 * and deliberately remain active.
 */
export function inactiveStatusFromEventTitle(
  title: string,
): { status: "cancelled" | "postponed"; note: string } | undefined {
  const normalized = title.normalize("NFKC").replace(/\s+/g, " ").trim();

  if (/\b(?:event\s+)?cancelled\b|\b(?:event\s+)?canceled\b/i.test(normalized)) {
    return {
      status: "cancelled",
      note: "Provider title indicates a cancelled listing",
    };
  }

  const explicitlyPostponed =
    /\b(?:event\s+)?postponed\s+(?:to|until)\b/i.test(normalized) ||
    /(?:^|[\[({\-–—])\s*(?:event\s+)?postponed\s*(?:$|[:\])}\-–—])/i.test(
      normalized,
    );
  const obsoleteReschedule =
    /\b(?:event\s+)?rescheduled\s+(?:to|from)\b/i.test(normalized) ||
    /\b(?:event\s+)?moved\s+to\b/i.test(normalized);

  if (explicitlyPostponed || obsoleteReschedule) {
    return {
      status: "postponed",
      note: "Provider title indicates an obsolete postponed or rescheduled listing",
    };
  }

  return undefined;
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export function deduplicateProviderEvents(
  events: NormalizedEvent[],
): NormalizedEvent[] {
  const byProviderId = new Map<string, NormalizedEvent>();
  for (const event of events) {
    const source = event.sources[0];
    const key = source
      ? `${source.provider}:${source.eventId}`
      : event.canonicalKey;
    byProviderId.set(key, event);
  }
  return [...byProviderId.values()];
}

export function haversineMiles(a: Coordinates, b: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const startLatitude = toRadians(a.latitude);
  const endLatitude = toRadians(b.latitude);
  const h =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(h));
}

/** Ticketmaster's current location parameter accepts a geohash. */
export function encodeGeohash(location: Coordinates, precision = 9): string {
  const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz";
  let latitudeRange: [number, number] = [-90, 90];
  let longitudeRange: [number, number] = [-180, 180];
  let hash = "";
  let bit = 0;
  let character = 0;
  let longitudeTurn = true;

  while (hash.length < precision) {
    const range = longitudeTurn ? longitudeRange : latitudeRange;
    const value = longitudeTurn ? location.longitude : location.latitude;
    const midpoint = (range[0] + range[1]) / 2;
    if (value >= midpoint) {
      character = (character << 1) | 1;
      range[0] = midpoint;
    } else {
      character <<= 1;
      range[1] = midpoint;
    }
    longitudeTurn = !longitudeTurn;
    bit += 1;

    if (bit === 5) {
      hash += alphabet[character];
      bit = 0;
      character = 0;
    }
  }

  return hash;
}

export function requestSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

const APPROVED_PROVIDER_HOSTS: Partial<Record<ProviderId, readonly string[]>> = {
  ticketmaster: [
    "ticketmaster.com",
    "ticketmaster.ca",
    "ticketmaster.co.uk",
    "ticketmaster.ie",
    "ticketmaster.com.au",
    "ticketmaster.co.nz",
    "ticketmaster.com.mx",
    "ticketmaster.de",
    "ticketmaster.fr",
    "ticketmaster.es",
    "ticketmaster.it",
    "ticketmaster.nl",
    "ticketmaster.be",
    "ticketmaster.at",
    "ticketmaster.ch",
    "ticketmaster.cz",
    "ticketmaster.dk",
    "ticketmaster.fi",
    "ticketmaster.no",
    "ticketmaster.pl",
    "ticketmaster.se",
  ],
  jambase: ["jambase.com"],
  fixture: ["example.test"],
};

/**
 * Provider URLs cross a trust boundary before being rendered as outbound links.
 * Accept only HTTPS URLs on an explicit provider-owned domain, with no embedded
 * username/password and no non-standard port. A suffix check includes official
 * subdomains but rejects lookalikes such as ticketmaster.com.evil.example.
 */
export function safeProviderUrl(
  provider: ProviderId,
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    if (url.port && url.port !== "443") return undefined;
    const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
    const approvedRoots = APPROVED_PROVIDER_HOSTS[provider] ?? [];
    const approved = approvedRoots.some(
      (root) => hostname === root || hostname.endsWith(`.${root}`),
    );
    return approved ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
